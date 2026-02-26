import json
import time
import pandas as pd
import requests
import msal

PBI_SCOPE = ["https://analysis.windows.net/powerbi/api/.default"]
PBI_BASE = "https://api.powerbi.com/v1.0/myorg"

def _get_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    authority = f"https://login.microsoftonline.com/{tenant_id}"
    app = msal.ConfidentialClientApplication(
        client_id=client_id,
        client_credential=client_secret,
        authority=authority
    )
    result = app.acquire_token_for_client(scopes=PBI_SCOPE)
    if "access_token" not in result:
        raise RuntimeError(f"Token error: {result.get('error_description', result)}")
    return result["access_token"]

def _dtype_to_pbi(dt) -> str:
    if pd.api.types.is_integer_dtype(dt):
        return "Int64"
    if pd.api.types.is_float_dtype(dt):
        return "Double"
    if pd.api.types.is_bool_dtype(dt):
        return "Boolean"
    if pd.api.types.is_datetime64_any_dtype(dt):
        return "DateTime"
    return "String"

def create_push_dataset_in_group(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    group_id: str,
    dataset_name: str,
    table_name: str,
    df: pd.DataFrame
) -> str:
    token = _get_token(tenant_id, client_id, client_secret)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Power BI push datasets have schema limits; keep it reasonable.
    df2 = df.copy()
    df2.columns = [str(c)[:200] for c in df2.columns]  # safety
    df2 = df2.iloc[:, :75]  # max columns guidance

    columns = [{"name": c, "dataType": _dtype_to_pbi(df2[c].dtype)} for c in df2.columns]

    body = {
        "name": dataset_name,
        "tables": [
            {"name": table_name, "columns": columns}
        ]
        # You can also specify retention policy etc. depending on needs
    }

    url = f"{PBI_BASE}/groups/{group_id}/datasets"
    r = requests.post(url, headers=headers, data=json.dumps(body), timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Create dataset failed ({r.status_code}): {r.text}")

    dataset_id = r.json().get("id")
    if not dataset_id:
        raise RuntimeError(f"Create dataset response missing id: {r.text}")
    return dataset_id

def push_rows_in_group(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    group_id: str,
    dataset_id: str,
    table_name: str,
    df: pd.DataFrame
):
    token = _get_token(tenant_id, client_id, client_secret)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    df2 = df.copy()
    # Convert datetimes to ISO strings for JSON
    for c in df2.columns:
        if pd.api.types.is_datetime64_any_dtype(df2[c]):
            df2[c] = df2[c].dt.strftime("%Y-%m-%dT%H:%M:%S")

    # Power BI push row limit: 10,000 rows per request
    max_rows = 10000
    n = len(df2)
    url = f"{PBI_BASE}/groups/{group_id}/datasets/{dataset_id}/tables/{table_name}/rows"

    for start in range(0, n, max_rows):
        chunk = df2.iloc[start:start + max_rows]
        payload = {"rows": chunk.to_dict(orient="records")}
        r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
        if r.status_code not in (200, 202):
            raise RuntimeError(f"Push rows failed ({r.status_code}): {r.text}")
        time.sleep(0.2)  # small throttle cushion

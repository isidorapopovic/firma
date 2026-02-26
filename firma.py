import io
import math
import joblib
import pandas as pd
import streamlit as st
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    accuracy_score, f1_score, classification_report
)
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier

# Optional Power BI push helpers (see pbi_push.py below)
try:
    from pbi_push import create_push_dataset_in_group, push_rows_in_group
    PBI_AVAILABLE = True
except Exception:
    PBI_AVAILABLE = False


st.set_page_config(page_title="Excel Analyzer + ML + Power BI", layout="wide")
st.title("Excel Analyzer + ML Predictions (+ optional Power BI Push)")

@st.cache_data(show_spinner=False)
def load_excel(uploaded_file) -> pd.DataFrame:
    # pandas can read .xlsx via openpyxl; .xls may require xlrd (older format)
    return pd.read_excel(uploaded_file)

def infer_task_type(y: pd.Series) -> str:
    # numeric => regression
    if pd.api.types.is_numeric_dtype(y):
        return "regression"
    # few unique values => classification
    nunique = y.nunique(dropna=True)
    if nunique <= 50:
        return "classification"
    return "classification"

def build_pipeline(X: pd.DataFrame, task: str):
    num_cols = [c for c in X.columns if pd.api.types.is_numeric_dtype(X[c])]
    cat_cols = [c for c in X.columns if c not in num_cols]

    numeric = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler(with_mean=False))
    ])
    categorical = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore"))
    ])

    pre = ColumnTransformer(
        transformers=[
            ("num", numeric, num_cols),
            ("cat", categorical, cat_cols),
        ],
        remainder="drop"
    )

    if task == "regression":
        model = RandomForestRegressor(
            n_estimators=300, random_state=42, n_jobs=-1
        )
    else:
        model = RandomForestClassifier(
            n_estimators=300, random_state=42, n_jobs=-1
        )

    return Pipeline(steps=[("pre", pre), ("model", model)])

# ---------- Sidebar: file upload ----------
with st.sidebar:
    st.header("1) Upload Excel")
    up = st.file_uploader("Choose .xlsx/.xls", type=["xlsx", "xls"])
    st.divider()
    st.header("2) Power BI (optional)")
    use_pbi = st.checkbox("Enable Power BI push (advanced)", value=False, disabled=not PBI_AVAILABLE)
    if use_pbi:
        tenant_id = st.text_input("Tenant ID")
        client_id = st.text_input("Client ID (App ID)")
        client_secret = st.text_input("Client Secret", type="password")
        group_id = st.text_input("Workspace ID (Group ID)")
        dataset_name = st.text_input("Dataset name", value="ExcelPredictions")
        table_name = st.text_input("Table name", value="Predictions")

# ---------- Load data ----------
df = None
if up is not None:
    try:
        df = load_excel(up)
        st.success(f"Loaded: {df.shape[0]} rows × {df.shape[1]} cols")
    except Exception as e:
        st.error(f"Failed to read Excel: {e}")

if df is None:
    st.info("Upload an Excel file to begin.")
    st.stop()

tabs = st.tabs(["Preview", "Analyze", "Predict", "Export / Power BI"])

# ---------- Preview ----------
with tabs[0]:
    st.subheader("Data preview")
    st.dataframe(df.head(50), use_container_width=True)

# ---------- Analyze ----------
with tabs[1]:
    st.subheader("Quick analysis")

    c1, c2, c3 = st.columns(3)
    with c1:
        st.metric("Rows", df.shape[0])
    with c2:
        st.metric("Columns", df.shape[1])
    with c3:
        missing = int(df.isna().sum().sum())
        st.metric("Missing cells", missing)

    st.write("**Missing values per column**")
    miss = df.isna().sum().sort_values(ascending=False)
    st.dataframe(miss.to_frame("missing"), use_container_width=True)

    st.write("**Describe (numeric)**")
    st.dataframe(df.describe(include="number").T, use_container_width=True)

    st.write("**Describe (categorical)**")
    st.dataframe(df.describe(include=["object", "category"]).T, use_container_width=True)

    # Simple correlation plot
    num = df.select_dtypes(include="number")
    if num.shape[1] >= 2:
        st.write("**Correlation heatmap (numeric)**")
        corr = num.corr(numeric_only=True)
        fig = plt.figure()
        plt.imshow(corr.values)
        plt.xticks(range(len(corr.columns)), corr.columns, rotation=90)
        plt.yticks(range(len(corr.columns)), corr.columns)
        plt.tight_layout()
        st.pyplot(fig)

# ---------- Predict ----------
with tabs[2]:
    st.subheader("Train a prediction model")

    target = st.selectbox("Choose target column", options=list(df.columns))
    feature_cols = [c for c in df.columns if c != target]

    # Basic feature selection option
    selected_features = st.multiselect(
        "Features to use (default: all except target)",
        options=feature_cols,
        default=feature_cols
    )

    if len(selected_features) == 0:
        st.warning("Select at least one feature.")
        st.stop()

    y = df[target]
    X = df[selected_features]

    task = infer_task_type(y)
    st.write(f"Detected task: **{task}**")

    test_size = st.slider("Test size", 0.1, 0.5, 0.2, 0.05)

    if st.button("Train model"):
        # Drop rows where target missing
        mask = y.notna()
        X2, y2 = X.loc[mask], y.loc[mask]

        X_train, X_test, y_train, y_test = train_test_split(
            X2, y2, test_size=test_size, random_state=42
        )

        pipe = build_pipeline(X_train, task)
        pipe.fit(X_train, y_train)

        # Evaluate
        y_pred = pipe.predict(X_test)

        if task == "regression":
            mae = mean_absolute_error(y_test, y_pred)
            rmse = math.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)
            st.write("**Metrics**")
            st.write({"MAE": float(mae), "RMSE": float(rmse), "R2": float(r2)})
        else:
            acc = accuracy_score(y_test, y_pred)
            f1 = f1_score(y_test, y_pred, average="weighted")
            st.write("**Metrics**")
            st.write({"Accuracy": float(acc), "F1 (weighted)": float(f1)})
            st.text("Classification report:")
            st.text(classification_report(y_test, y_pred))

        # Predict on full dataset (where features available)
        full_pred = pipe.predict(X)
        out = df.copy()
        out[f"prediction__{target}"] = full_pred

        st.session_state["trained_model"] = pipe
        st.session_state["predictions_df"] = out

        st.success("Model trained. Predictions added as a new column.")
        st.dataframe(out.head(50), use_container_width=True)

        # Save model
        buf = io.BytesIO()
        joblib.dump(pipe, buf)
        st.download_button(
            "Download trained model (.joblib)",
            data=buf.getvalue(),
            file_name="model.joblib",
            mime="application/octet-stream"
        )

# ---------- Export / Power BI ----------
with tabs[3]:
    st.subheader("Export predictions for Power BI, or push via API")

    pred_df = st.session_state.get("predictions_df")
    if pred_df is None:
        st.info("Train a model first to generate predictions.")
        st.stop()

    csv_bytes = pred_df.to_csv(index=False).encode("utf-8")
    st.download_button(
        "Download predictions CSV (import to Power BI Desktop)",
        data=csv_bytes,
        file_name="predictions.csv",
        mime="text/csv"
    )

    st.write("### Power BI notes")
    st.write(
        "- **Easiest path:** import the CSV into Power BI Desktop, build visuals, publish.\n"
        "- **More advanced:** push rows into a *Push Dataset* via Power BI REST APIs. "
        "Push datasets have limits like **10,000 rows per POST** and other throttles."
    )

    if use_pbi:
        if not PBI_AVAILABLE:
            st.error("pbi_push.py not found. Create it (below) next to app.py.")
        else:
            if st.button("Create dataset + Push predictions to Power BI"):
                if not all([tenant_id, client_id, client_secret, group_id]):
                    st.error("Fill Tenant ID, Client ID, Client Secret, Workspace ID.")
                else:
                    # Keep only Power BI-friendly columns (avoid very wide tables)
                    safe = pred_df.copy()
                    if safe.shape[1] > 60:
                        safe = safe.iloc[:, :60]

                    ds_id = create_push_dataset_in_group(
                        tenant_id=tenant_id,
                        client_id=client_id,
                        client_secret=client_secret,
                        group_id=group_id,
                        dataset_name=dataset_name,
                        table_name=table_name,
                        df=safe
                    )
                    push_rows_in_group(
                        tenant_id=tenant_id,
                        client_id=client_id,
                        client_secret=client_secret,
                        group_id=group_id,
                        dataset_id=ds_id,
                        table_name=table_name,
                        df=safe
                    )
                    st.success(f"Done. Dataset created + rows pushed. Dataset ID: {ds_id}")

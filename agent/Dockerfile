# Microservicio IA — Python 3.12 + FastAPI + LangGraph (uvicorn :8000)
# Imagen slim: no necesita compilar nada (httpx, pydantic, langchain traen wheels).
FROM python:3.12-slim

WORKDIR /app

# Dependencias primero (capa cacheable: solo se reinstala si cambia requirements).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Código del agente.
COPY . .

EXPOSE 8000

# main.py no define bloque __main__; se arranca con uvicorn apuntando a `app`.
# --host 0.0.0.0 para ser accesible desde la red interna de compose (no solo localhost).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

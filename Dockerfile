ARG OCTO_RUNTIME_BASE=registry.fly.io/octodrop-platform-api:runtime-base-py311-playwright
FROM ${OCTO_RUNTIME_BASE}

WORKDIR /app

COPY . /app

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]

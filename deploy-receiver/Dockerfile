FROM python:3.12-slim

WORKDIR /app

RUN useradd -m -u 1000 receiver && \
    chown -R receiver:receiver /app

USER receiver

COPY --chown=receiver:receiver receiver.py railway_client.py ./

ENV PORT=8080
EXPOSE 8080

CMD ["python", "receiver.py"]

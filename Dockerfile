FROM rust:1-alpine3.24 AS builder

WORKDIR /app
COPY . .

RUN apk add --no-cache  musl-dev perl linux-headers
RUN cargo build --release --bin subconverter --features web-api --locked

FROM alpine:3.24
LABEL maintainer="@jat001"

WORKDIR /app

COPY --from=builder /app/target/release/subconverter /app/
COPY --from=builder /app/base /app/


RUN apk add --no-cache ca-certificates tzdata libgcc libstdc++ \
    && chmod +x /app/subconverter

ENV TZ=Asia/Shanghai

EXPOSE 25500

CMD ["./subconverter"]

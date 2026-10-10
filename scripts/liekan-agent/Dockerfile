FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
COPY agent.mjs container.mjs LICENSE ./
RUN mkdir -p /var/lib/liekan-agent && chown 65532:65532 /var/lib/liekan-agent \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER 65532:65532
ENTRYPOINT ["node", "/app/container.mjs"]
CMD ["run"]

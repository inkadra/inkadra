# Next version

## Read before upgrading

- **Reports to the developers:** every instance where no administrator saved a choice becomes able to send reports to the Inkadra developers, even if they were off until now. No report leaves unless someone writes it, sees its preview and sends it. Selected text, screenshots, videos, files and logs leave the server and pass through Cloudflare, which sees the server's IP address. To avoid this, set an empty `FEEDBACK_RELAY_URL=` before upgrading, then save a choice in Settings → Reports. Details in `docs/self-hosting/configuration.md`.

## For whoever publishes the version

- Publish the `inkadra-report-relay` Worker before the image (`relay/README.md`). If the order is reversed, reports wait in the queue and none is lost.

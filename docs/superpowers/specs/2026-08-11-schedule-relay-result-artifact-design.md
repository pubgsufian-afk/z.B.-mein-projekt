# Encrypted schedule relay result artifact

The protected GitHub OIDC schedule relay must make encrypted management results machine-retrievable without exposing plaintext schedule data.

- Only `encryptedResult` returned by the OIDC trigger may be persisted.
- The response key remains only inside the RSA/AES-encrypted command envelope and is never logged or written to the artifact.
- When an encrypted result exists, the relay script writes one JSON artifact file to a temporary path supplied by the workflow.
- GitHub Actions uploads that file as a short-lived artifact.
- Commands without an encrypted result do not create an artifact and remain successful.
- Existing encrypted log output remains for compatibility.
- No employee or schedule plaintext may be written to GitHub logs or artifacts.

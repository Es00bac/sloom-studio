# Vertex AI Authentication in Sloom Studio

> **Current-source baseline:** `0.9.16-b`, August 27, 2026. Model availability, regions,
> quotas, billing, and IAM are controlled by Google and can change independently of this
> application. Confirm the exact model route in Google's current documentation before a paid run.

Sloom Studio can use Google Application Default Credentials (ADC) without asking the user to type a
terminal command. The most portable path is to import the JSON credential file directly in
**Settings → Providers → Vertex AI**. The application validates the file, obtains/refreshes a
token, discovers accessible projects, and uses the selected project and region for supported Text,
Image, and Video Flow nodes. A visible Test connection result is evidence that authentication
worked; it is not a promise that every model is available in that project or region.

Official background: [how ADC searches for credentials](https://cloud.google.com/docs/authentication/application-default-credentials), [Vertex AI initial setup](https://cloud.google.com/vertex-ai/docs/start/cloud-environment), and [Vertex generative AI locations](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations).

## Fastest no-terminal setup

1. Open **Settings → Providers → Vertex AI**.
2. Set Google credentials to **Vertex ADC**.
3. Under **Built-in ADC import**, choose the JSON file or expand **Paste credential JSON instead**.
4. Select or enter a Google Cloud project. If the credential can list projects, **Refresh projects** populates the menu automatically.
5. Pick the Vertex region required by the selected model. `global` or `us-central1` are sensible starting points only when that model's documentation lists them.
6. Optionally set a quota project when billing/quota must be charged to a different project.
7. Choose **Test connection**.

No Google Cloud SDK or terminal is needed for an imported `authorized_user` or `service_account` file. On desktop, the broker also supports Google external-account/workload-identity credential files through Google's authentication library.

## Supported credential paths by platform

| Platform | Terminal-free import | Existing ADC detection | Optional account sign-in | Execution path |
| --- | --- | --- | --- | --- |
| Windows desktop | Authorized-user, service-account, external-account, or impersonated-service-account JSON | `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CONFIG`, then `%APPDATA%\gcloud\application_default_credentials.json` | **Google browser sign-in** launches the installed Cloud SDK flow when available; no command typing | Native Electron token broker and Vertex REST |
| macOS desktop | Authorized-user, service-account, external-account, or impersonated-service-account JSON | `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CONFIG`, then `~/.config/gcloud/application_default_credentials.json` (or `XDG_CONFIG_HOME`) | Same optional Cloud SDK browser flow | Native Electron token broker and Vertex REST |
| Linux desktop | Authorized-user, service-account, external-account, or impersonated-service-account JSON | `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CONFIG`, then `~/.config/gcloud/application_default_credentials.json` (or `XDG_CONFIG_HOME`) | Same optional Cloud SDK browser flow | Native Electron token broker and Vertex REST |
| Android | Authorized-user or service-account JSON | Imported credential stored in the app; desktop filesystem paths do not apply | Import is the supported standalone path | Direct authenticated Vertex REST, including Veo long-running-operation polling |

An external-account or impersonated-service-account file on Android is parsed so the user gets a specific message, but currently requires the desktop broker. This limitation does not affect the common gcloud ADC `authorized_user` file or service-account JSON.

## What each credential type means

### Authorized-user ADC

An `authorized_user` JSON contains a client ID, client secret, and refresh token created by a Google user sign-in. Sloom Studio exchanges the refresh token inside the application and caches only the short-lived access token in memory. The quota project embedded in the file is adopted when the field in Settings is empty.

This is the closest equivalent to “I already have ADC credentials; let me use them in the app.” Import the `application_default_credentials.json` file directly.

### Service account

A `service_account` JSON contains a private key and service-account email. Sloom Studio signs the OAuth assertion locally and obtains a short-lived access token. Prefer workload identity or user ADC when practical; Google recommends avoiding long-lived service-account keys where a keyless alternative exists. See [Google's service-account key guidance](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).

Grant only the roles the production actually needs. Typical failures involve missing Vertex AI access, service-usage permissions, project discovery permission, or storage access for model outputs.

### External account / workload identity

The desktop broker passes external-account and impersonated-service-account JSON to the official Google authentication library. Availability depends on the referenced subject-token source and the machine's access to it. Android standalone does not currently evaluate those external subject-token sources.

## Storage and privacy

- Credentials are local and are never committed into a `.sloom` project.
- The settings blob is encrypted at rest. Electron uses the OS credential facility exposed by `safeStorage` (DPAPI on Windows, Keychain on macOS, and the available secret service on Linux). Android/WebView uses AES-GCM with a non-extractable WebCrypto key held in IndexedDB.
- The credential JSON is decrypted only into application memory when Settings or a Vertex request needs it.
- If the runtime reports that encrypted storage is unavailable, do not import a long-lived credential; fix the platform credential store first.
- Exported settings backups are separately encrypted with the passphrase chosen by the user.

To remove an imported credential, clear the **ADC credential JSON** field and save/close Settings. Revoking an authorized-user refresh token is an account-side action in Google security controls. Deleting or disabling a service-account key is an IAM action in Google Cloud.

## Project, API, IAM, billing, and region requirements

Authentication alone is not authorization. The selected project must also have:

- billing enabled where the selected model requires it;
- the Vertex AI API enabled;
- IAM permissions for the intended prediction/generation operation;
- project visibility if the project picker is expected to discover it;
- model availability in the selected location and account rollout.

Project discovery uses the Resource Manager API with the short-lived access token. A failure to list projects does not invalidate the credential; enter a known project ID manually and test it. See the [Resource Manager projects API](https://cloud.google.com/resource-manager/reference/rest/v1/projects/list) and [Vertex AI access control](https://cloud.google.com/vertex-ai/docs/general/access-control).

## Route-aware model selection

Google exposes some models through different API families:

- Gemini Developer API model IDs use an API key and Gemini endpoints.
- Vertex `-001` model IDs use ADC and Vertex publisher endpoints.
- Preview Gemini Veo IDs and Vertex GA Veo IDs are not interchangeable.
- Gemini TTS currently uses the Gemini API-key route in Flow; Vertex ADC is used for supported text, image, and video routes.

The node keeps every model selectable so a workflow can be designed before credentials are present.
It shows a route/credential warning and disables **Run** when the selected model cannot execute
through the active credential route. Unsupported controls and handles remain visible with their
reason, but cannot be connected or sent to the API. An apparent model name match is not enough:
the provider family, credential route, and selected region must all agree.

## Troubleshooting by failure layer

| Message or symptom | Likely layer | What to check |
| --- | --- | --- |
| Credential JSON cannot be parsed | File/import | Import the complete JSON file; verify its `type` and required fields. Do not paste a token or a console screenshot. |
| Authorized-user token refresh failed | OAuth token exchange | The refresh token may be revoked/expired or the OAuth client may no longer be valid. Re-authorize and import a fresh ADC file. |
| Service-account assertion/token failure | Key or clock | Confirm the private key and client email belong together, the key is enabled, and device time is correct. |
| External-account requires desktop broker | Platform capability | Use the Windows/macOS/Linux app for that credential, or use authorized-user/service-account ADC on Android. |
| Project list is empty or forbidden | Resource Manager IAM | Enter the exact project ID manually; project-list permission is separate from Vertex prediction permission. |
| Vertex API disabled | Service setup | Enable the Vertex AI API in the selected project. |
| Permission denied on generation | IAM | Grant the credential the minimum Vertex role/permissions needed by that operation. |
| Billing or quota error | Billing/quota project | Verify billing, project quota, and the optional quota-project ID. |
| Model not found / unavailable | Model route, region, or rollout | Check exact model ID, Gemini-vs-Vertex route, selected region, project allowlist, and lifecycle warning. |
| Browser sign-in button cannot start | Desktop compatibility path | The optional sign-in button needs Google Cloud SDK installed. Use built-in JSON import instead; it has no SDK dependency. |
| Imported file works on desktop but not Android | Credential type | Android supports authorized-user and service-account import; external/impersonated credentials currently require desktop. |

## Compatibility with existing ADC setups

Sloom Studio does not replace standard ADC behavior. On desktop it checks explicit environment configuration first, then the standard Cloud SDK ADC location for the operating system. The built-in Google authentication library obtains the token directly; `gcloud auth print-access-token` remains a last-resort compatibility fallback. Project listing is performed through Resource Manager rather than by parsing `gcloud projects list` output.

This means existing users can keep their current ADC setup, while users who only possess the
credential JSON can complete the supported setup entirely inside Sloom Studio. Credentials remain
the user's responsibility: rotate/revoke them with Google, keep project and billing access scoped,
and never put ADC JSON in a `.sloom` project, provider pack, repository, or support screenshot.

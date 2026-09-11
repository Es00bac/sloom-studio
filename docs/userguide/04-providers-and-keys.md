# 4. Providers & API keys

Cloud generation calls the AI **providers** you connect with your **own keys**, directly from your
device or through the documented native bridge. Local/Open endpoints and the Android Accelerator
provide supported local routes. There is no Sloom-hosted inference relay, so **you** choose what a
generation costs and where its input goes.

## Where to enter keys

Open **Settings** (the gear in the top bar) and go to the **Providers** section. Each provider has
its own card where you paste a key (or sign in). Keys are stored on your device only.

The same section now includes **Providers & Model Cards**. It uses one portable format for bundled
providers and providers you connect yourself. Choose **Connect provider** to discover models and
build cards, or import a reviewed `.sloom-provider.json` pack. See
[Provider packs & model cards](14-provider-packs-model-cards.md) for the visual workflow.

## Supported providers

| Provider | What it's for | How you connect |
|---|---|---|
| **Google Gemini** | Image (incl. "Nano Banana") and text models | Paste a Gemini API key from Google AI Studio |
| **Google Vertex AI** | Gemini image + Veo video at Google Cloud scale | Sign in with `gcloud`, or import a service-account JSON; pick project + region |
| **OpenAI** | Image and text models; OpenAI-compatible endpoints | Paste an OpenAI key (and, optionally, a custom base URL) |
| **Hugging Face** | The Hugging Face inference catalog | Paste a Hugging Face token |
| **Stability AI** | Stable Diffusion family | Paste a Stability key |
| **Black Forest Labs (FLUX)** | FLUX image models | Paste a FLUX key |
| **Atlas Cloud** | A broad image **and video** catalog through one gateway (FLUX, Qwen, Nano Banana, Wan, Veo, Seedance, Grok-Imagine, …) | Paste an Atlas API key |
| **ElevenLabs** | Voice and audio | Paste an ElevenLabs key |
| **Local/Open** | OpenAI-compatible local or self-hosted image endpoints | Enter the endpoint and its local credential if required |
| **Android Accelerator** | Supported generation and upscaling on a paired Android device | Pair the LAN endpoint and bearer token shown by the companion |

You only need the providers you actually use. One key (for example Gemini or Atlas Cloud) is
enough to start.

## Google Vertex AI sign-in

Vertex AI is the one provider with more than a paste-a-key step, because it uses Google Cloud
authentication. Sloom Studio supports three paths:

1. **Desktop — Sign in with gcloud.** Click **Sign in with gcloud** in the Vertex panel; Sloom
   Studio runs the Google Cloud `application-default login` flow, detects your credentials, and lets
   you pick a **project** and **region** from a dropdown. (If you already have Application Default
   Credentials set up, use **Detect ADC**.)
2. **Mobile, standalone — service account.** Import a Google Cloud **service-account JSON** key
   and use **Test connection** to confirm it works. Sloom Studio mints and caches access tokens on
   device.
3. **Advanced — environment variables.** If you run with ADC environment variables set, Sloom
   Studio will use them; the env-var path is exposed under an advanced disclosure.

After signing in you can use Gemini image models ("Nano Banana") and Veo video on Vertex.

## How cost works

Because you call providers directly with your own key, **you are billed by the provider**, not by
Sloom Studio. Flow nodes show a **run-cost estimate** before generation and record known actual or
estimated cost in the project usage ledger. A project-level **Flow spend cap** can refuse a dispatch
before money is spent when the planned total would exceed the cap or pricing is unknown. Estimates
are not a substitute for the provider's final bill.

## Privacy

- Keys are stored **on your device** and sent only to the matching provider.
- Portable provider packs and project snapshots contain named credential slots, never credential
  values. Dynamic credentials are included only inside an explicitly passphrase-encrypted settings
  backup.
- Your prompts and media go **only** to the provider you choose for that generation.
- Sloom Studio has **no content account, hosted inference relay, or content telemetry**. The Play
  licensing service does not receive project media. A self-hosted sync/review server sees only the
  project data you deliberately send to that server.

## Same model, any provider

Several models are reachable through more than one path (for example FLUX directly or through
Atlas Cloud). Sloom Studio reads each model's real **capabilities** — reference images, masks,
image-to-video, and so on — and exposes the same controls wherever that model runs. Capabilities
follow the model, not the menu.

---

Next: [Flow workspace →](05-flow.md)

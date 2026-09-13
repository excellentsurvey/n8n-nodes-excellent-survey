# Excellent Survey for n8n

The **Excellent Survey Trigger** receives new completed responses through OAuth2 and automatic subscription registration. It includes the complete typed response and convenient `answersById` / `displayAnswersById` objects. Question IDs remain stable when titles change. `id` is the original event ID.

The connector has been tested on a self-hosted n8n **2.38.7** instance with Node **24.21.0**, including OAuth consent, automatic token refresh, survey selection, saved-response delivery, and subscription removal. Public package publication and n8n verification are separate release steps; n8n Cloud availability requires n8n's approval.

## Instance setup

1. In your self-hosted n8n instance, sign in as an owner or administrator. Open **Settings → Community nodes → Install**, enter **`n8n-nodes-excellent-survey`**, and follow the installation prompts. See [n8n's community-node installation instructions](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/). The [published npm package](https://www.npmjs.com/package/n8n-nodes-excellent-survey) is available for self-hosted installations; n8n Cloud availability requires n8n verification.
2. Expose n8n's webhook endpoint through **public HTTPS**. The website must be able to reach it. A localhost callback or a private network address is not a supported receiving destination.
3. Create an **Excellent Survey OAuth2 API** credential. Contact **support@excellentsurvey.com** with its **OAuth Redirect URL** for exact callback registration. Enter the issued client ID and secret in n8n's encrypted credential fields. Then select **Connect my account**, sign in, and approve survey access.
4. Add **Excellent Survey Trigger**, select the credential and a survey, then activate/publish the workflow in n8n. The node automatically registers its callback. Deactivation removes that callback's subscription. A test listener has a separate subscription so it cannot remove the production subscription.
5. Complete a designated synthetic fixture survey to verify the receiving workflow, then deactivate it and check that its subscription is removed. Reconnect the credential to authorize additional surveys.

No application client secret is bundled in this npm package. Self-hosted n8n instances have different OAuth redirect URLs, so an unregistered instance cannot have universal one-click OAuth. This is the same callback-registration constraint documented for [n8n's Typeform OAuth2 credential](https://docs.n8n.io/integrations/builtin/credentials/typeform/). The user never pastes a webhook URL; the one-time operator step registers the OAuth client, then n8n manages webhook subscriptions.

## Build and test

For development, use Node 24 or newer. The connector is built against `n8n-workflow` 2.16.0; its peer dependency follows n8n's required `*` convention, which does not establish compatibility with every historical release. You can build and pack this directory to install a local development tarball in a separate self-hosted test instance.

```sh
npm ci
npm run lint
npm test
npm pack
```

`dist/` contains the credential, trigger and local brand icon. There are no application secrets or arbitrary runtime dependencies in the packed node. Tests compile against the pinned n8n types and mock the n8n request helper to verify survey selection, multiple subscriptions, test/production isolation, deletion retry, typed answer preservation, and event filtering. OAuth token refresh is delegated to n8n's inherited OAuth2 credential/request helper; these tests do not run a hosted n8n OAuth session.

The receiver uses n8n's generated callback address, validates event version/type/survey, and ignores synthetic tests. Do not disclose the callback URL. This API version does not return a webhook signing secret to native connectors, so this node does not claim independent HMAC signature verification. Use event `id` for downstream idempotency; n8n does not automatically deduplicate this trigger's workflow executions. Do not discard an event before the receiving action successfully handles it.

Only future completed responses are delivered. Renaming a question does not break question-ID mappings; deleting and recreating it produces a different ID. Existing Excellent Survey responses are not modified or backfilled.

## Example workflow

Import [Watch Responses](examples/watch-responses.json) into your test instance, select your credential and survey, and start the listener. The example is inactive, contains only the trigger, and includes no credentials or response data. Complete a new response to the selected survey to inspect its output before adding destination actions.

## Troubleshooting

- **No survey options:** reconnect and approve the required survey. Check that the credential belongs to the correct account.
- **Authorization or access errors:** follow the displayed recovery guidance; reconnect the credential or approve the survey again when required.
- **No response arrives:** check that the workflow or test listener is listening, complete a new response to the selected survey, and check public HTTPS reachability. Starting a listener does not replay old responses.
- **Subscription removal fails:** correct the connection or network error and retry deactivation. The node retains its subscription record until deletion succeeds.

Contact **support@excellentsurvey.com** for service or callback-registration support.

## Publication

The repository's manually started **Publish package** GitHub Actions workflow verifies the public repository identity and exact package version, runs lint and tests, and publishes with npm provenance. Publication and n8n verification are separate steps; npm availability does not imply n8n Cloud approval.

Before publication, complete real-instance OAuth and delivery tests. See [community-node requirements](https://docs.n8n.io/integrations/community-nodes/building-community-nodes/) and [n8n's built-in Typeform trigger source](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Typeform/TypeformTrigger.node.ts).

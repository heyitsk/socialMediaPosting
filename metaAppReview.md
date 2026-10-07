# Meta App Review: submission text

Paste-ready text for **App Review → Permissions and Features** in the Meta app
dashboard (app id 1575982267231848), plus the notes for the reviewer. Written
from what the code requests today (`backend/src/lib/{facebook,instagram,threads}.ts`).
Re-read it against the code before submitting, and against Meta's current form.

Do **not** put the reviewer's password in this file. Enter it only in the
dashboard's review notes.

## What smPosting is (the opening sentence for every permission)

smPosting is a web app (https://app.postuploaders.com) where a person connects
their own social accounts, writes a post once, and publishes or schedules it to
the accounts they choose. It only ever acts on accounts the signed-in person
connected, and only to publish what they wrote.

## Facebook Login for Business

| Permission | Why we need it |
|---|---|
| `pages_show_list` | To list the Facebook Pages the person manages, so they can choose which Page to connect. |
| `business_management` | Pages that belong to a Meta Business portfolio are not returned by the Pages list without it. We use it only so those Pages appear in the list. We do not read or change any other business asset. |
| `pages_manage_posts` | To publish the post the person wrote (text, photos, video) to the Page they chose, at the time they chose. |
| `pages_read_engagement` | Required alongside `pages_manage_posts` to use the Page's access token, and to read the processing status of a video we uploaded, so we can tell the person whether it went live. |
| `instagram_basic` | To read the id and username of the Instagram professional account linked to the connected Page, so the person can pick it as a posting target. |
| `instagram_content_publish` | To publish the person's photo, carousel or Reel to that Instagram account. |

## Instagram API with Instagram Login

| Permission | Why we need it |
|---|---|
| `instagram_business_basic` | To read the id and username of the Instagram professional account the person signs in with, and show it in their list of connected accounts. |
| `instagram_business_content_publish` | To publish the person's photo, carousel or Reel to that account. |

## Threads API

| Permission | Why we need it |
|---|---|
| `threads_basic` | To read the id and username of the Threads profile the person signs in with, and show it in their list of connected accounts. |
| `threads_content_publish` | To publish the person's post to that Threads profile. |

## How the data is handled (if a form asks)

- Access tokens are encrypted at rest (AES-256-GCM) and never sent to the browser.
- Disconnecting an account in smPosting, or removing the app in Facebook,
  Instagram or Threads settings, deletes our stored tokens. Meta's deauthorize
  callback does the same automatically.
- Full policy: https://app.postuploaders.com/privacy
  Terms: https://app.postuploaders.com/terms
  Deletion instructions: https://app.postuploaders.com/data-deletion

## Notes for the reviewer (paste into the dashboard)

1. Open https://app.postuploaders.com and click "Continue with Google".
2. Sign in with the test account given in the credentials field of this
   submission. It is a normal Google account with no 2-step prompt.
3. On the Dashboard, under "Connected accounts", click "Connect" next to
   Facebook (or Instagram, or Threads). Accept the permission dialog.
4. Open "Composer", pick the connected account, write a caption, optionally add
   an image, and click Publish.
5. The post appears on the account within a minute or so. The result also shows
   in "History".
6. To remove access, click "Disconnect" on the Dashboard.

## Screencast checklist (one recording per product, English, with captions)

1. Start signed out on https://app.postuploaders.com.
2. Sign in with Google. Show the URL bar.
3. Click Connect. Show the full Meta permission dialog with every permission
   from the table above visible. (Remove the app in Facebook settings first, so
   the dialog actually appears.)
4. Return to smPosting and show the connected account in the list.
5. Compose and publish a post to it.
6. Open the real Facebook Page, Instagram account or Threads profile and show
   the post live there.
7. Show Disconnect. Do not show any secret, token or password.

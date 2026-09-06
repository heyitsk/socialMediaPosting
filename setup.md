# 🛠️ Setup Guide — Test Accounts & Developer Apps

> This guide walks you through setting up test accounts, business pages, and developer credentials for every platform in the V1 product.  
> **Context**: You currently have personal accounts on all platforms. Some require conversion to business accounts before the API will allow posting.

---

## Table of Contents

1. [Facebook — Create a Business Page](#1-facebook--create-a-business-page)
2. [Instagram — Convert to Business/Creator Account](#2-instagram--convert-to-businesscreator-account)
3. [Meta Developer App — Covers Both FB + IG](#3-meta-developer-app--covers-both-fb--ig)
4. [Reddit — Create a Developer App](#4-reddit--create-a-developer-app)
5. [YouTube / Google — Set Up YouTube Data API](#5-youtube--google--set-up-youtube-data-api)
6. [Pinterest — Business Account + Developer App](#6-pinterest--business-account--developer-app)
7. [X (Twitter) — Developer Account Setup](#7-x-twitter--developer-account-setup)
8. [Quora — Monitoring Only (No API)](#8-quora--monitoring-only-no-api)
9. [n8n Docker — Required Environment Variables](#9-n8n-docker--required-environment-variables)
10. [Credentials Checklist Summary](#10-credentials-checklist-summary)

---

## 1. Facebook — Create a Business Page

### Why you need this
The Facebook API **does not allow posting to personal profiles**. You need a Facebook Page (which represents a business, brand, or public figure).

### Steps

**Step 1 — Log into your personal Facebook account**
> You need a personal account to own a Page. The Page is separate from your profile.

**Step 2 — Go to Page Creation**
- Visit: https://www.facebook.com/pages/create
- Or: Click the **+** (Create) button in the top navigation bar → Select **Page**

**Step 3 — Fill in Page details**
- **Page Name**: Your agency or business name (e.g., "Acme Marketing Co.")
- **Category**: Start typing your industry — e.g., "Marketing Agency", "Advertising Agency"
- **Description**: 1–2 sentences about the business (optional at this stage)
- Click **Create Page**

**Step 4 — Complete the Page profile**
- Upload a **Profile Picture** (logo) — recommended: 170×170 px
- Upload a **Cover Photo** — recommended: 820×312 px
- Add **Contact Info**: Website, phone, email, address
- Click **Save**

**Step 5 — Find your Page ID (you'll need this for n8n)**
- Go to your Page
- Click **About** in the left sidebar
- Scroll to the bottom — you'll find **Page ID** (a long number like `123456789012345`)
- Save this number — it's your `PAGE_ID` for API calls

> **Test Page Tip**: Create a test page named "Test Business [YourName]" with Category "Test Account". This way you can experiment freely without affecting a real business page.

---

## 2. Instagram — Convert to Business/Creator Account

### Why you need this
Instagram's API **only supports Business or Creator accounts**. Personal accounts cannot publish via API. You already have a personal account — just convert it.

### Steps

**Step 1 — Open Instagram on your phone**

**Step 2 — Go to Settings**
- Tap your profile picture (bottom right)
- Tap the **hamburger menu** (three lines, top right)
- Tap **Settings and Privacy**

**Step 3 — Switch account type**
- Tap **Account type and tools**
- Tap **Switch to Professional Account**
- Tap **Continue** through the prompts

**Step 4 — Choose account type**
- **Business**: Choose this if you represent a brand, agency, or company
- **Creator**: For influencers, public figures, artists
- For this product, choose **Business**

**Step 5 — Select a category**
- Choose the category that best fits: "Marketing Agency", "Advertising/Marketing", etc.

**Step 6 — Connect to a Facebook Page**
- You'll be prompted to connect to a Facebook Page
- Select the Page you created in Step 1
- If prompted, log in to Facebook and authorize the connection
- This connection is **mandatory** for the Instagram API to work

**Step 7 — Get your Instagram User ID**
- Once connected, go to: https://graph.facebook.com/me/accounts?access_token=YOUR_PAGE_TOKEN
- Or use the Meta Graph API Explorer (covered in Section 3)
- Your Instagram Business Account ID (a long number) will be needed for n8n

> **Important**: After conversion, your Instagram account remains visible to your followers exactly as before — conversion does not change how your profile looks to others.

---

## 3. Meta Developer App — Covers Both FB + IG

Both Facebook and Instagram use the same Meta Graph API. You only need **one Meta Developer App** for both platforms.

### Steps

**Step 1 — Create a Meta Developer Account**
- Visit: https://developers.facebook.com
- Click **Get Started** (top right)
- Log in with your personal Facebook account
- Accept the developer terms

**Step 2 — Create a new App**
- Click **My Apps** (top right) → **Create App**
- Choose **Other** as use case (most flexible for testing)
- Select **Business** as the App Type
- App Name: e.g., "SMPosting Test App"
- App Contact Email: your email
- Click **Create App**

**Step 3 — Add the Instagram Graph API product**
- In your app dashboard, find **Add a Product** section
- Click **Set up** next to **Instagram Graph API**

**Step 4 — Add the Facebook Login product**
- Also click **Set up** next to **Facebook Login for Business**
- Under Settings → Valid OAuth Redirect URIs, add your n8n OAuth callback URL:
  - Format: `https://YOUR_N8N_DOMAIN/rest/oauth2-credential/callback`
  - For local Docker testing: `http://localhost:5678/rest/oauth2-credential/callback`

**Step 5 — Generate a Page Access Token**
- Go to: https://developers.facebook.com/tools/explorer/
- Select your App from the dropdown (top right)
- Click **Generate Access Token** — log in and grant all requested permissions
- Select your Facebook Page from the dropdown
- Add these permissions:
  - `pages_show_list`
  - `pages_manage_posts`
  - `pages_read_engagement`
  - `instagram_basic`
  - `instagram_content_publish`
- Click **Generate Access Token** and copy the token

**Step 6 — Convert to Long-Lived Token (important!)**
Short-lived tokens expire in 1 hour. Convert to a 60-day token:

```
GET https://graph.facebook.com/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id={APP_ID}&
  client_secret={APP_SECRET}&
  fb_exchange_token={SHORT_LIVED_TOKEN}
```

You can run this in the Graph API Explorer or via a browser/curl.

**Step 7 — Get a Never-Expiring Page Token (recommended for production)**
After getting the 60-day user token:
```
GET https://graph.facebook.com/{PAGE_ID}?
  fields=access_token&
  access_token={LONG_LIVED_USER_TOKEN}
```
The `access_token` in the response is a **permanent Page Access Token**.

**Step 8 — Save your credentials**
- App ID (from App Settings → Basic)
- App Secret (from App Settings → Basic → click "Show")
- Page Access Token (from Step 7)
- Page ID (from Section 1, Step 5)
- Instagram User ID (find via Graph API Explorer: query `me/accounts` to find IG account ID)

**Step 9 — Put your app in "Live" mode for testing with real accounts**
- In App Dashboard → App Review → toggle from **Development** to **Live**
- Note: In Development mode, only app admins/testers can use the token

---

## 4. Reddit — Create a Developer App

### Steps

**Step 1 — Log into Reddit**
- Use a dedicated test Reddit account (optional but recommended to avoid affecting your main account's karma/standing)
- Or use your existing account

**Step 2 — Create a Developer App**
- Go to: https://www.reddit.com/prefs/apps
- Scroll to the bottom of the page
- Click **Create another app...** (or "are you a developer? create an app...")

**Step 3 — Fill in App details**
- **Name**: e.g., "SMPosting Bot"
- **App Type**: Select **Script** (best for server-side automation where you control the account)
  - Note: "Script" apps authenticate as *you*, not as external users
- **Description**: "Automated social media posting tool"
- **Redirect URI**: `http://localhost:8080` (required field, even for script apps)
- Click **Create App**

**Step 4 — Copy your credentials**
After creation, you'll see:
- **Client ID**: The string *under* your app name (looks like a short random string)
- **Client Secret**: Click **edit** to reveal it

**Step 5 — Set up in n8n**
- In n8n: Add credential → Reddit OAuth2 API
- Enter: Client ID, Client Secret
- Username + Password (for Script-type authentication)

**Step 6 — Verify your test subreddit**
- Use `r/test` or `r/testingground4bots` for initial testing
- These are official test subreddits for bot developers
- Do NOT test-post in real public subreddits — it's against subreddit rules

> **Note on Commercial Use**: Reddit's API policy requires that commercial apps submit a formal request via their developer support form. If you're building this as a product for clients, submit the form at: https://support.reddithelp.com/hc/en-us/requests/new

---

## 5. YouTube / Google — Set Up YouTube Data API

### Steps

**Step 1 — Create a Google Cloud Project**
- Visit: https://console.cloud.google.com
- Click the project dropdown (top left) → **New Project**
- Name it: "SMPosting V1"
- Click **Create**

**Step 2 — Enable YouTube Data API v3**
- In the left sidebar: **APIs & Services** → **Library**
- Search for "YouTube Data API v3"
- Click on it → Click **Enable**

**Step 3 — Configure OAuth Consent Screen**
- Go to: **APIs & Services** → **OAuth consent screen** (or "Google Auth Platform")
- Click **Get Started** if first time
- User Type: **External** (allows any Google account to authorize)
- App Name: "SMPosting"
- User support email: your email
- Developer contact email: your email
- Click **Save and Continue**

**Step 4 — Add Scopes**
- Click **Add or Remove Scopes**
- Search for and add:
  - `https://www.googleapis.com/auth/youtube`
  - `https://www.googleapis.com/auth/youtube.upload`
- Click **Update** → **Save and Continue**

**Step 5 — Add Test Users**
- On the "Test Users" step, click **Add Users**
- Add your Google account email (the one with the YouTube channel)
- Click **Save and Continue** → **Back to Dashboard**

**Step 6 — Create OAuth2 Credentials**
- Go to: **APIs & Services** → **Credentials**
- Click **+ Create Credentials** → **OAuth client ID**
- Application Type: **Web Application**
- Name: "n8n YouTube"
- Authorized Redirect URIs → Add:
  - `http://localhost:5678/rest/oauth2-credential/callback` (for local Docker testing)
  - Your production n8n URL if applicable
- Click **Create**
- Download or copy the **Client ID** and **Client Secret**

**Step 7 — Personal vs Brand Channel**
- If you're posting to a **Brand Account / Brand Channel**:
  - When connecting in n8n, use `prompt=consent select_account` in the OAuth URL
  - This forces Google to show you a channel picker to select the correct channel
- If posting to a **personal YouTube channel**: standard OAuth flow works fine

**Step 8 — Set up in n8n**
- In n8n: Add credential → Google OAuth2 API
- Enter: Client ID, Client Secret
- Scopes: `https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload`

> **YouTube Channel Test**: Upload a test video set to "Private" or "Unlisted" privacy to verify the workflow without making it public.

---

## 6. Pinterest — Business Account + Developer App

### Step 1 — Convert to a Pinterest Business Account

You need a **Business account** to access the Pinterest API.

- Log into Pinterest
- Go to: https://www.pinterest.com/business/convert/
- Click **Upgrade for free**
- Fill in: Business name, type of business, website URL
- Click **Next** → **Done**

> Converting is free and reversible. Your existing pins and boards are unaffected.

### Step 2 — Create a Pinterest Developer App

- Go to: https://developers.pinterest.com
- Click **My Apps** → **Connect App**
- Fill in:
  - **App Name**: "SMPosting V1"
  - **App Description**: "Social media automation tool for marketing agencies"
  - **App URL**: Your website or `http://localhost` for testing
  - **Redirect URIs**: `http://localhost:5678/rest/oauth2-credential/callback`
- Accept the terms → Click **Connect**
- Copy your **App ID** and **App Secret Key**

### Step 3 — Test in Sandbox (Trial Mode)

- By default, your app starts in **Trial Mode**
- In Trial Mode, pins you create are only visible to your account (not public)
- This is perfect for testing — use Trial Mode for development

### Step 4 — Apply for Standard Access (for production)

When ready to go live with real clients:
- Go to: https://developers.pinterest.com/docs/getting-started/set-up-app/
- Click **Request standard access** on your app page
- You'll need to provide:
  - A screen recording of your OAuth authorization flow
  - Demonstration of at least one core API action (creating a pin)
  - Business use case description
- Approval typically takes 3–7 business days

### Step 5 — Configure in n8n

- In n8n: Add credential → Generic OAuth2 API
- Name: "Pinterest OAuth2"
- Authorization URL: `https://www.pinterest.com/oauth/`
- Access Token URL: `https://api.pinterest.com/v5/oauth/token`
- Client ID: Your App ID
- Client Secret: Your App Secret Key
- Scope: `boards:read,pins:read,pins:write`

### Step 6 — Get your Board IDs

Before creating pins, you need your Board IDs:
- Make a `GET` request to: `https://api.pinterest.com/v5/boards`
- This returns all your boards with their IDs
- Save the Board ID(s) you want to post to in your Google Sheets content calendar

---

## 7. X (Twitter) — Developer Account Setup

> **Important**: The X API is now fully pay-per-use. There is no free tier for posting tweets as of February 2026. You must add credits to proceed.

### Step 1 — Apply for a Developer Account

- Visit: https://developer.x.com/en/portal/petition/essential/basic-info
- Sign in with your X account
- Fill in the application:
  - **Use case**: "Automated social media posting for marketing agencies"
  - **Description**: Explain that this is for scheduling and automating posts for business clients
- Submit the application
- Approval is usually instant or within 24 hours

### Step 2 — Create a Project and App

- In the Developer Portal: **Projects & Apps** → **+ Add Project**
- Project Name: "SMPosting V1"
- Use Case: "Making a bot" or "Automating and bots"
- App Name: "SMPosting Bot" (must be unique across all of X)
- Click **Complete**

### Step 3 — Configure App Permissions

- In your app settings → **User authentication settings** → **Edit**
- App permissions: Select **Read and Write**
- Type of App: **Web App, Automated App or Bot**
- Callback URI: `http://localhost:5678/rest/oauth2-credential/callback`
- Website URL: Your website or `http://localhost`
- Click **Save**

### Step 4 — Get your API Keys

- Go to: **Keys and tokens** tab in your app
- **API Key** and **API Secret Key**: Shown once — save them immediately
- Under **OAuth 2.0 Client ID and Client Secret**: Click **Generate** — save both
- These are your n8n credentials

### Step 5 — Add Credits (Required for Posting)

- In the Developer Portal: Go to **Billing**
- Add a payment method
- Load credits (minimum varies — typically $10–$25 to start)
- Monitor usage via the dashboard

### Step 6 — Configure in n8n

- In n8n: Add credential → X (Twitter) OAuth2 API
- Client ID: OAuth 2.0 Client ID (from Step 4)
- Client Secret: OAuth 2.0 Client Secret (from Step 4)
- Follow the OAuth flow in n8n to authorize

> **Troubleshooting**: If you get a `403 Forbidden` error when posting, go back to your app's User Authentication Settings and verify "Read and Write" is selected. Then regenerate your access token in n8n.

---

## 8. Quora — Monitoring Only (No API)

Quora has no public API for posting. Do **not** attempt automation.

### What you CAN do with Quora in n8n (for research):

- **RSS Feed Monitoring**: Quora topics have RSS feeds in the format:
  `https://www.quora.com/topic/TOPIC-NAME/rss`
  Use n8n's `RSS Feed Read` node to monitor for new questions on topics relevant to your clients

- **Alert Workflow**: n8n reads Quora RSS → filters for relevant keywords → sends Slack/email alert to your team → team manually answers the question with high-quality content

This is the **safe, legitimate, and effective** way to use Quora for marketing — manual answers with genuine value drive far better results than automated bots anyway.

---

## 9. n8n Docker — Required Environment Variables

Add these to your Docker Compose or `.env` file:

```yaml
# docker-compose.yml (relevant section)
services:
  n8n:
    environment:
      # Store binary files (videos, images) on disk instead of memory
      - N8N_DEFAULT_BINARY_DATA_MODE=filesystem
      
      # Set your n8n public URL (required for OAuth callbacks)
      # For local testing:
      - N8N_EDITOR_BASE_URL=http://localhost:5678
      # For production (replace with your domain):
      # - N8N_EDITOR_BASE_URL=https://n8n.yourdomain.com
      
      # Webhook URL (same as above, for receiving OAuth callbacks)
      - WEBHOOK_URL=http://localhost:5678/
      
      # Timezone (for accurate scheduling)
      - GENERIC_TIMEZONE=Asia/Kolkata
      
      # Optional: set a specific binary data base path
      - N8N_BINARY_DATA_TTL=60
```

> **Why `N8N_DEFAULT_BINARY_DATA_MODE=filesystem`?**  
> When uploading YouTube videos or large images, n8n needs to store them on disk rather than in memory to prevent crashes. This is critical for any video posting workflow.

---

## 10. Credentials Checklist Summary

Use this checklist to track what you've set up:

### Facebook
- [ ] Facebook Business Page created
- [ ] Page ID saved: `__________________________`
- [ ] Meta Developer App created (App ID: `_____________`)
- [ ] App Secret saved: `__________________________`
- [ ] Long-lived / Permanent Page Access Token generated and saved
- [ ] n8n credential configured: Facebook Graph API

### Instagram
- [ ] Instagram account converted to Business type
- [ ] Facebook Page linked to Instagram account
- [ ] Instagram Business Account ID found: `__________________`
- [ ] `instagram_content_publish` permission granted in Meta token
- [ ] n8n uses same Facebook Graph API credential (shared with Facebook)

### Reddit
- [ ] Reddit developer app created (Script type)
- [ ] Client ID saved: `__________________________`
- [ ] Client Secret saved: `__________________________`
- [ ] n8n credential configured: Reddit OAuth2 API
- [ ] Test post verified in r/test or r/testingground4bots

### YouTube
- [ ] Google Cloud Project created
- [ ] YouTube Data API v3 enabled
- [ ] OAuth Consent Screen configured (External)
- [ ] Test user added to OAuth consent screen
- [ ] OAuth2 Client ID saved: `__________________________`
- [ ] OAuth2 Client Secret saved: `__________________________`
- [ ] n8n credential configured: Google OAuth2 API
- [ ] Test video uploaded (Private/Unlisted)

### Pinterest
- [ ] Pinterest account converted to Business
- [ ] Pinterest Developer App created
- [ ] App ID saved: `__________________________`
- [ ] App Secret saved: `__________________________`
- [ ] Board IDs fetched and saved in content sheet
- [ ] n8n credential configured: Generic OAuth2 API
- [ ] Trial mode testing complete
- [ ] Standard Access requested (if going live)

### X (Twitter)
- [ ] X Developer Account approved
- [ ] Project and App created
- [ ] App permissions set to Read + Write
- [ ] Callback URL configured in Developer Portal
- [ ] OAuth 2.0 Client ID saved: `__________________________`
- [ ] OAuth 2.0 Client Secret saved: `__________________________`
- [ ] Billing credits loaded
- [ ] n8n credential configured: X (Twitter) OAuth2 API
- [ ] Test tweet posted successfully

### n8n Docker
- [ ] `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` set
- [ ] `WEBHOOK_URL` set to correct n8n URL
- [ ] `GENERIC_TIMEZONE=Asia/Kolkata` set
- [ ] n8n restarted after env changes

---

*Last updated: 2026-08-11 | Setup Guide v1*

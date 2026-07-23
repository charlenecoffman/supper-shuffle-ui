# Supper Shuffle

A browser-only React meal planner. Each person authorizes Google directly, and Supper Shuffle creates or reopens a private JSON data file in Google Drive's hidden application-data storage.

## Architecture

- `src/App.tsx` — React interface and interactions
- `src/googleDrive.ts` — Google Identity Services plus direct hidden Drive app-data access
- `src/styles.css` — responsive application styling
- `.env.local` — ignored local Google OAuth web client ID

There is no application backend. Google access tokens are kept in browser memory, are never persisted, and require the user to reconnect after expiration or a page refresh. The browser stores only the ID of the hidden app-data file created for that signed-in user. The file does not appear in My Drive or Recent and is only accessible to Supper Shuffle.

## Google Cloud setup

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Configure the Google Auth Platform for an external audience.
4. Create a Web application OAuth client with the local and deployed origins.
5. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to the public web client ID.

Under **Google Auth Platform → Data Access**, add the non-sensitive `https://www.googleapis.com/auth/drive.appdata` scope. The app requests only this scope, which limits it to Supper Shuffle's hidden application-data folder.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Production build

```bash
npm run build
npm start
```

## Deployment

Pushes to `main` run `.github/workflows/deploy-supper-shuffle.yml`, which tests the app, builds `dist/`, and syncs it to S3.

Required GitHub Actions repository secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET`
- `VITE_GOOGLE_CLIENT_ID`

Add the final HTTPS CloudFront or custom-domain origin to the Google OAuth client's Authorized JavaScript origins before deploying.

## Validation

```bash
npm test
```

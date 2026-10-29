# Savor Recipe Finder

Savor is a MERN recipe finder with recipe search, favorites, accounts, recipe submissions, and an admin review panel.

## Run locally

1. Start MongoDB and configure `server/.env` using `server/.env.example` as a guide.
2. In one terminal, run `cd server && npm install && npm run dev`.
3. In another terminal, run `cd client && npm install && npm run dev`.
4. Open the Vite URL printed in the client terminal (usually `http://localhost:5174`).

## Deploy publicly on Render

The root `render.yaml` configures one Render web service to build the React client and serve it with the Express API. The frontend and API then share one public URL.

1. Create a MongoDB Atlas cluster and database user. Add the Render service's network access as allowed in Atlas, and copy the application's connection string.
2. In Render, choose **New → Blueprint**, connect this GitHub repository, and apply the `render.yaml` configuration.
3. When Render asks for environment values, enter `MONGODB_URI`, `SUPERADMIN_EMAIL`, and a strong `SUPERADMIN_PASSWORD`. Render generates `JWT_SECRET` for the service.
4. Wait for the deploy to finish, then open the public `onrender.com` URL shown in Render.

The free Render web service may sleep after 15 minutes without traffic, so the first visit after idle time can take a little longer. The local MongoDB database is not copied to Atlas automatically; the app seeds its curated recipes when it connects, while accounts and newsletter signups need to be migrated separately if you want to keep them.

Never commit `server/.env` or paste its secrets into the repository. Set production secrets in Render's environment settings.

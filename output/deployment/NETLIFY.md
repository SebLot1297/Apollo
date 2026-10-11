# CommandGrid manual deployment on Netlify

Render hosts the Python backend at https://apollo-uwg4.onrender.com. Aiven hosts the database. This package connects the static frontend's REST requests and simulation WebSockets to Render.

## Download and deploy

1. Download `output/deployment/commandgrid-frontend-netlify.zip` from the `codex/commandgrid-foundation` branch. This is the built website, not the GitHub repository source ZIP.
2. Extract the ZIP. The extracted folder must contain `index.html`, `_redirects`, and `assets` directly inside it.
3. Open the **existing** CommandGrid project in Netlify, then **Deploys**. Drag the extracted folder into the manual deployment area. Publish the new deployment if required. The domain remains attached to the existing project.
4. In Render's backend environment, set `CORS_ORIGINS` to `https://commandgrid.us,https://www.commandgrid.us,http://commandgrid.us`, then save and redeploy. The HTTP origin supports testing while the domain certificate is pending; remove it after HTTPS is working. Add the exact Netlify site origin if you also use its `.netlify.app` address.
5. Open the site and hard-refresh. Confirm backend readiness, saved missions, and live telemetry.

The prebuilt package already includes the backend URL. Setting a Netlify environment variable does not change a manually uploaded build. It contains no database passwords or AI keys.

## Domain configuration

Edit records at the provider serving the domain's active nameservers. On October 10, 2026, `commandgrid.us` used Porkbun nameservers, despite the earlier GoDaddy assumption.

- Root: ALIAS to `apex-loadbalancer.netlify.com`, or Netlify's specified apex records.
- `www`: CNAME to your actual `your-site.netlify.app` hostname. Replace the parking record pointing to `pixie.porkbun.com`.
- Check Netlify **Domain management > HTTPS** after both names resolve correctly.

## Rebuild the package

From the repository root, with Node.js and dependencies installed:

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts/package-netlify.ps1
```

For another backend, supply `-BackendUrl https://your-backend.example`. `VITE_API_BASE_URL` is public build configuration; never put credentials in it. Local development continues to use Vite's same-origin proxy when this variable is unset.

Every source update requires rebuilding and uploading a new package when using manual deployment. Downloading the repository source alone does not produce a new frontend build.

## References

- [Netlify manual deployments](https://docs.netlify.com/deploy/create-deploys/)
- [External DNS configuration](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- [HTTPS certificates](https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/)

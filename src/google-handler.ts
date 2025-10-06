import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	if (
		await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, env.COOKIE_ENCRYPTION_KEY)
	) {
		return redirectToGoogle(c.req.raw, oauthReqInfo);
	}

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			description: "AI tutor + spaced repetition scheduling!",
			logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
			name: "Spaced Repetition MCP Server", // optional
		},
		state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
	});
});

app.post("/authorize", async (c) => {
	// Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
	const { state, headers } = await parseRedirectApproval(c.req.raw, env.COOKIE_ENCRYPTION_KEY);
	if (!state.oauthReqInfo) {
		return c.text("Invalid request", 400);
	}

	return redirectToGoogle(c.req.raw, state.oauthReqInfo, headers);
});

async function redirectToGoogle(
	request: Request,
	oauthReqInfo: AuthRequest,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.GOOGLE_CLIENT_ID,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "openid email profile",
				state: btoa(JSON.stringify(oauthReqInfo)),
				upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
			}),
		},
		status: 302,
	});
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from Google after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback", async (c) => {
	// Get the oathReqInfo out of KV
	const oauthReqInfo = JSON.parse(atob(c.req.query("state") as string)) as AuthRequest;
	if (!oauthReqInfo.clientId) {
		return c.text("Invalid state", 400);
	}

	// Exchange the code for an access token
	const [accessToken, errResponse] = await fetchUpstreamAuthToken({
		client_id: c.env.GOOGLE_CLIENT_ID,
		client_secret: c.env.GOOGLE_CLIENT_SECRET,
		code: c.req.query("code"),
		redirect_uri: new URL("/callback", c.req.url).href,
		upstream_url: "https://oauth2.googleapis.com/token",
	});
	if (errResponse) return errResponse;

	// Fetch the user info from Google
	const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!userInfoResponse.ok) {
		return c.text("Failed to fetch user info", 500);
	}

	const userInfo = (await userInfoResponse.json()) as {
		id: string;
		email: string;
		verified_email: boolean;
		name: string;
		given_name: string;
		family_name: string;
		picture: string;
	};

	const { email, name } = userInfo;

	// Return back to the MCP client a new token
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: name,
		},
		// This will be available on this.props inside MyMCP
		props: {
			accessToken,
			email,
			login: email, // Use email as the unique identifier
			name,
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: email, // Use email as userId for consistency
	});

	return Response.redirect(redirectTo);
});

export { app as GoogleHandler };

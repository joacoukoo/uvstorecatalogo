export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    anthropic: !!env.ANTHROPIC_API_KEY,
    github_token: !!env.GITHUB_TOKEN,
    github_repo: env.GITHUB_REPO || null,
  }), { headers: { 'Content-Type': 'application/json' } });
}

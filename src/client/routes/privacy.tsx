export default function Privacy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            <span className="mr-2">🔧</span>stepfix privacy
          </h1>
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Back
          </a>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-5 py-6 prose prose-gray">
        <h2>What we collect</h2>
        <p className="text-gray-700">
          When you start a support session, stepfix stores your conversation
          with the AI agent, including any text you paste and screenshots you
          share. This data lives in a private session that is deleted
          automatically after 24 hours. You can also delete it yourself at any
          time by clicking "Delete my session" in the session page.
        </p>

        <h2>What we do with it</h2>
        <p className="text-gray-700">
          Your session data is used only to help fix your problem. It is never
          sold or shared with third parties. Conversation text may be processed
          by our AI providers to generate responses. In the beta, the default
          privacy mode is off, which means some providers (Gemini free tier) may
          use content to improve their products. You can turn on privacy mode to
          exclude those providers.
        </p>

        <h2>Secrets</h2>
        <p className="text-gray-700">
          We try to detect and mask known secret patterns (API keys, passwords,
          tokens) before they reach the server. This is a best-effort filter —
          you should still avoid pasting sensitive information. Never type
          passwords or recovery codes into the chat.
        </p>

        <h2>Commands</h2>
        <p className="text-gray-700">
          Every command the agent suggests comes from a public, reviewed
          library. The AI cannot invent commands. You run every command yourself
          — the agent never touches your machine.
        </p>

        <h2>AI disclosure</h2>
        <p className="text-gray-700">
          Both the Support and Technician agents are AI. They can sound natural
          but they are not human. If you ask, they will say so.
        </p>

        <h2>Delete my data</h2>
        <p className="text-gray-700">
          Click "Delete my session" on the session page, or just wait 24 hours.
          The session and all its data are permanently removed.
        </p>
      </div>
    </div>
  );
}

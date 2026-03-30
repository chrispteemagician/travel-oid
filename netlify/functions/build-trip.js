// netlify/functions/build-trip.js

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const apiKey = process.env.GEMINIAPIKEY || process.env.GEMINI_API_KEY || process.env.GOOGLEAIAPIKEY || process.env.GOOGLEAPIKEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };

    const body = JSON.parse(event.body || "{}");
    const { destination, dates, travelStyle, interests, userName } = body;
    if (!destination) return { statusCode: 400, headers, body: JSON.stringify({ error: "Destination required" }) };

    const safeInterests = Array.isArray(interests) ? interests.filter(i =>
      ["cannabis","bridgewalker","coins","music","food","photography","history","markets"].includes(i)
    ) : [];

    const interestList = safeInterests.length ? safeInterests.join(", ") : "general";
    const style = travelStyle || "solo, AuDHD-friendly, budget-conscious";
    const name = userName || "Doc Strange";

    const prompt = `You are Doc, a well-travelled local friend. Build a tight offline travel pack for ${name} going to ${destination}${dates ? ' in ' + dates : ''}. Style: ${style}. Interests: ${interestList}.

Reply ONLY with valid JSON, no markdown:
{
  "title": "short title",
  "summary": "2 sentences max — vibe and one thing to remember",
  "destination": "${destination}",
  "transport": [{"label":"Airport to centre","method":"name","detail":"specific line, stop, time","cost":"€X"}],
  "sim": {"advice":"where to buy, which network, cost","bestOption":"one clear pick"},
  "neighbourhoods": [{"name":"name","vibe":"short","stayHere":true,"notes":"what to know"}],
  "safety": ["specific tip","ND-friendly tip","money tip"],
  "phrases": [{"en":"English","local":"local","phonetic":"how to say","use":"when"}],
  "interests": {${safeInterests.includes("cannabis") ? `
    "cannabis": {"legalStatus":"current status","howToAccess":"step by step for visitors","clubs":[{"name":"name","area":"area","notes":"how to join"}],"tips":["tip1"]}` : ""}${safeInterests.includes("bridgewalker") ? `${safeInterests.includes("cannabis") ? "," : ""}
    "bridgewalker": {"spots":[{"name":"name","type":"type","area":"area","notes":"why"}],"tips":["tip1"]}` : ""}${safeInterests.includes("music") ? `,
    "music": {"venues":[{"name":"name","type":"type","area":"area","notes":"notes"}],"tips":["tip1"]}` : ""}${safeInterests.includes("food") ? `,
    "food": {"dishes":["dish1","dish2"],"spots":[{"name":"name","area":"area","type":"type","notes":"why locals go"}],"tips":["tip1"]}` : ""}${safeInterests.includes("photography") ? `,
    "photography": {"spots":[{"name":"name","area":"area","notes":"best time, what's special"}],"tips":["tip1"]}` : ""}${safeInterests.includes("coins") ? `,
    "coins": {"shops":[{"name":"name","area":"area","notes":"what they stock"}],"tips":["tip1"]}` : ""}},
  "emergency": {"police":"number","medical":"hospital info","embassy":"UK embassy if applicable","lostPassport":"what to do"},
  "docNotes": "1 sentence of pure Doc wisdom about this place"
}

Be specific. Real names, real costs, real lines. Keep phrases to 6. Keep safety to 4 bullets. Keep neighbourhoods to 2.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.7 },
    };

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );
        if (!res.ok) {
          const text = await res.text();
          lastError = new Error(`Gemini ${res.status}: ${text}`);
          if (res.status === 429 || res.status === 500) continue;
          return { statusCode: 200, headers, body: JSON.stringify({ error: "Doc's brain is busy. Try again." }) };
        }
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p.text || "").filter(Boolean).join(" ");
        if (!text) return { statusCode: 200, headers, body: JSON.stringify({ error: "No response from Doc. Try again." }) };

        let parsed;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        try { parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text); }
        catch(e) { parsed = { title: destination + " — Doc's Pack", summary: text.slice(0, 300) }; }

        return { statusCode: 200, headers, body: JSON.stringify(parsed) };
      } catch (err) { lastError = err; }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ error: "Too many attempts. Give Doc a minute." }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error. Try again." }) };
  }
};

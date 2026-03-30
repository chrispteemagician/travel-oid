// netlify/functions/build-trip.js

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const apiKey = process.env.GEMINIAPIKEY || process.env.GEMINI_API_KEY || process.env.GOOGLEAIAPIKEY || process.env.GOOGLEAPIKEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const { destination, dates, travelStyle, interests, userName } = body;

    if (!destination) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Destination required" }) };
    }

    const safeInterests = Array.isArray(interests) ? interests.filter(i =>
      ["cannabis", "bridgewalker", "coins", "music", "food", "history", "photography", "markets"].includes(i)
    ) : [];

    const prompt = buildTripPrompt({ destination, dates, travelStyle, interests: safeInterests, userName });

    const payload = {
      system_instruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2048 },
    };

    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 16000)));
      }
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );

        if (!res.ok) {
          const text = await res.text();
          lastError = new Error(`Gemini ${res.status}: ${text}`);
          if (res.status === 429 || res.status === 500) continue;
          return { statusCode: 200, headers, body: JSON.stringify({ error: "Doc's brain is busy. Try again in a moment." }) };
        }

        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought) || data.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p.text || "").filter(Boolean).join(" ");

        if (!text) {
          return { statusCode: 200, headers, body: JSON.stringify({ error: "Doc couldn't build the pack. Try again." }) };
        }

        let parsed;
        const jsonMatch = text.match(/\{[\s\S]*\}$/);
        try {
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        } catch (e) {
          parsed = { title: `${destination} — Doc's Pack`, summary: text.slice(0, 600), transport: [], sim: "", safety: [], phrases: [], interests: {}, neighbourhoods: [] };
        }

        return { statusCode: 200, headers, body: JSON.stringify(parsed) };
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    console.error("build-trip retries exhausted", lastError);
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Too many requests. Give Doc a minute." }) };
  } catch (error) {
    console.error("build-trip error", error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error. Try again." }) };
  }
};

function buildSystemPrompt() {
  return `
You are Doc, The Traveller — the AI engine inside Travel-Oid. Your job is to generate a PERSONALISED OFFLINE TRAVEL PACK for a specific destination. This pack will be saved to the user's phone and read WITHOUT internet. It must be accurate, local, and practical.

You are NOT a tourist guide. You are a well-travelled local friend who knows the real spots. Not TripAdvisor. Not Instagram. The nuggets only locals know.

You must ALWAYS reply in VALID JSON ONLY, no markdown, no commentary, with this exact shape:

{
  "title": "Short human title, e.g. Bilbao — April 2026",
  "summary": "2-3 sentences: the vibe, what to expect, the one thing to remember.",
  "destination": "City, Country",
  "generatedAt": "ISO date string",

  "transport": [
    {
      "label": "Airport to city centre",
      "method": "Metro / Bus / Taxi",
      "detail": "Specific line, stop, cost, journey time. Mention if there are scams to avoid at the airport.",
      "cost": "Approximate cost with currency"
    }
  ],

  "sim": {
    "advice": "Where to buy a local SIM at or near the airport. Which networks. Rough cost. Data amounts. Any ID required.",
    "bestOption": "One clear recommendation"
  },

  "neighbourhoods": [
    {
      "name": "Neighbourhood name",
      "vibe": "Short description — who stays here, what it feels like",
      "stayHere": true,
      "notes": "What to look for, what to avoid, noise levels, safety"
    }
  ],

  "safety": [
    "Specific, practical safety point — not generic advice.",
    "Local-knowledge safety tip.",
    "ND-friendly tip: noise, crowds, escape routes.",
    "Money / pickpocket / scam note if relevant."
  ],

  "phrases": [
    { "en": "English phrase", "local": "Local language phrase", "phonetic": "How to say it", "use": "When to use this" }
  ],

  "interests": {
    "cannabis": {
      "legalStatus": "Current legal status for tourists / prescription holders",
      "howToAccess": "Step by step — how a visitor actually accesses cannabis legally",
      "clubs": [
        { "name": "Club name if known", "area": "Neighbourhood", "notes": "How to join / what to expect / any known details" }
      ],
      "tips": ["Practical tip 1", "Practical tip 2"]
    },
    "bridgewalker": {
      "spots": [
        { "name": "Space / venue name", "type": "market / maker / community / cowork", "area": "Neighbourhood", "notes": "What happens there, why a community connector would care" }
      ],
      "tips": ["Tip for connecting with locals rather than tourists"]
    },
    "coins": {
      "shops": [{ "name": "Shop or market name", "area": "Neighbourhood", "notes": "What they stock, opening hours if known" }],
      "tips": ["Tip for coin collectors visiting this city"]
    },
    "music": {
      "venues": [{ "name": "Venue", "type": "live / club / record shop", "area": "Neighbourhood", "notes": "Genre, atmosphere, typical nights" }],
      "tips": ["Tip for music lovers"]
    },
    "food": {
      "dishes": ["Local dish 1 to try", "Local dish 2"],
      "spots": [{ "name": "Place name", "area": "Neighbourhood", "type": "cafe / market / restaurant", "notes": "Why locals go here" }],
      "tips": ["Practical food tip — not tourist trap"]
    },
    "photography": {
      "spots": [{ "name": "Location", "area": "Neighbourhood", "notes": "Best time of day, what makes it special, any permits needed" }],
      "tips": ["Photography tip for this city"]
    }
  },

  "emergency": {
    "police": "Local emergency number",
    "medical": "Medical emergency / hospital info",
    "embassy": "UK embassy or consulate contact if applicable",
    "lostPassport": "What to do if passport is lost in this country"
  },

  "docNotes": "1-3 sentences of pure Doc wisdom about this destination. The thing he'd tell you over a coffee that doesn't fit anywhere else."
}

RULES:
- Only include interest sections for the interests the user selected. Omit the rest entirely.
- Be specific. Real names, real costs, real areas. If you don't know something, say "check on arrival" rather than making it up.
- ND-friendly throughout: calm, clear, no overwhelm, escape plans where relevant.
- Safety first. Never encourage illegal activity.
- Cannabis section: be accurate about legal status for UK prescription holders / tourists. In Spain, cannabis social clubs are legal but private — explain the joining process clearly.
- Keep phrases to 6-8 most useful. Quality over quantity.
- Keep the whole response tight. This is an offline pack — it must load fast and read easy.
`;
}

function buildTripPrompt({ destination, dates, travelStyle, interests, userName }) {
  const interestList = interests.length > 0 ? interests.join(", ") : "general travel";
  return `Build a personalised offline travel pack for:

Destination: ${destination}
Dates: ${dates || "not specified"}
Travel style: ${travelStyle || "solo, budget-conscious, AuDHD-friendly"}
Interests: ${interestList}
Traveller: ${userName || "Doc Strange"}

Focus on the interests listed. Include only those interest sections in the JSON.
Make it feel like a trusted local friend briefed you the night before. Not TripAdvisor. Not Instagram. Real.`;
}

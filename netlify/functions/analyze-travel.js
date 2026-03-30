// netlify/functions/analyze-travel.js

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const apiKey =
      process.env.GEMINIAPIKEY || process.env.GOOGLEAIAPIKEY || process.env.GOOGLEAPIKEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "API key not configured" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { image, mode, budgetLevel, travellerType, notes } = body || {};

    if (!image || !image.data || !mode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing image or mode" }),
      };
    }

    const safeMode = mode === "roast" ? "roast" : "plan";
    const safeBudget =
      budgetLevel === "balanced" || budgetLevel === "treat"
        ? budgetLevel
        : "ultra-budget";
    const safeTraveller =
      ["solo", "with-kids", "with-mates", "nomad"].includes(travellerType)
        ? travellerType
        : "solo";

    const systemPrompt =
      safeMode === "plan"
        ? buildPlanSystemPrompt()
        : buildRoastSystemPrompt();

    const userPrompt = buildUserPrompt({
      budgetLevel: safeBudget,
      travellerType: safeTraveller,
      notes: notes || "",
    });

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          parts: [{ text: userPrompt }],
        },
        {
          parts: [
            {
              inline_data: {
                mime_type: image.mediaType || "image/jpeg",
                data: image.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1024,
      },
    };

    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
            apiKey,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        if (!res.ok) {
          const text = await res.text();
          lastError = new Error("Gemini status " + res.status + ": " + text);
          if (res.status === 429 || res.status === 500) {
            continue;
          }
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              error:
                "The travel brain is busy. Try again in a moment, kid.",
            }),
          };
        }

        const data = await res.json();
        const parts =
          data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought) ||
          data.candidates?.[0]?.content?.parts ||
          [];
        const text = parts
          .map((p) => p.text || "")
          .filter(Boolean)
          .join(" ");

        if (!text) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              error:
                "Doc couldn’t read that one. Try a clearer image or a different angle.",
            }),
          };
        }

        // Expect valid JSON
        let parsed;
        const jsonMatch = text.match(/\{[\s\S]*\}$/);
        try {
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        } catch (e) {
          // Fallback: wrap into minimal structure
          parsed = {
            title: "Doc’s rough blueprint",
            summary: text.slice(0, 400),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(parsed),
        };
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    console.error("analyze-travel retries exhausted", lastError);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error:
          "Too many people planning at once. Give Doc a breather and try again.",
      }),
    };
  } catch (error) {
    console.error("analyze-travel error", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server error. Doc dropped his notebook. Try again.",
      }),
    };
  }
};

function buildUserPrompt({ budgetLevel, travellerType, notes }) {
  return (
    "You are looking at a travel-related image or screenshot. " +
    "Use it, plus the extra context, to design a realistic trip.\n\n" +
    "Budget level: " +
    budgetLevel +
    "\n" +
    "Traveller type: " +
    travellerType +
    "\n" +
    "Extra notes from user: " +
    notes +
    "\n\n" +
    "Return your answer as a single JSON object ONLY, no commentary, no markdown."
  );
}

function buildPlanSystemPrompt() {
  return `
You are Doc, The Traveller, inside Travel-Oid. You turn one image plus a bit of text into a realistic, ND‑friendly trip blueprint. You work with real-world constraints: money, energy, safety, and time.

You must ALWAYS reply in VALID JSON ONLY, no markdown, no extra words, with this exact shape:

{
  "title": "Short human title for the trip",
  "summary": "1–3 sentences describing the vibe and core idea.",
  "routes": [
    {
      "label": "Main Route",
      "legs": [
        { "from": "City A (CODE)", "to": "City B (CODE)", "notes": "Short note about timing, transfers, or airline." }
      ],
      "estimatedCost": "Rough total price in currency range, e.g. £600-800",
      "hassleLevel": "low | medium | high",
      "energyLoad": "low | medium | high"
    }
  ],
  "stays": [
    {
      "city": "City name",
      "nights": 3,
      "area": "Neighbourhood suggestion",
      "vibe": "Short description calm / party / family etc.",
      "notes": "What to look for in a hotel/hostel"
    }
  ],
  "workspaces": [
    {
      "city": "City name",
      "name": "Example workspace name or type",
      "type": "coworking | cafe | hotel-lobby",
      "approxDayRate": "Rough day rate with currency",
      "notes": "WiFi / quiet / chair quality"
    }
  ],
  "dailyRhythm": {
    "summary": "1–2 sentence overview of how to pace days.",
    "suggestedPattern": [
      "Short sentence per step, e.g. Day 1-2: arrive, sleep, walk, no big plans.",
      "Another short line about activity vs rest balance."
    ]
  },
  "safetyAndSanity": {
    "headline": "Safety and sanity check",
    "points": [
      "Specific, practical safety point.",
      "Another point about ND triggers (noise, crowds, chaos).",
      "Money / documents safeguard.",
      "Optional extra, max 6 total."
    ]
  },
  "packingHints": [
    "Short packing hint focussed on calm and safety.",
    "Another short hint.",
    "Keep list under 5 items."
  ],
  "amazonSearch": "2–5 word search term for relevant travel or nomad gear.",
  "rawText": "Optional slightly longer human explanation or notes. Keep under 500 words."
}

RULES:
- SAFETY FIRST: never encourage illegal, exploitative, or reckless behaviour. Warn clearly about obvious risks and suggest safer variants.
- ND-FRIENDLY BY DEFAULT: assume the traveller may be autistic/ADHD/anxious. Prefer fewer city moves, calmer areas, and clear escape plans.
- MONEY HONESTY: include rough price ranges and hidden costs where relevant (transfers, baggage, city taxes), but keep numbers approximate.
- REALITY OVER AESTHETICS: mention jet lag, long transfers, weird arrival times if they matter. Avoid fantasy schedules that break people.
- LESS IS FINE: do not stuff the itinerary. One main thing per day plus breathing room is acceptable.

If you are missing key details (exact dates, exact cities), you still produce a GENERAL blueprint that makes sense for the image and context, clearly labelled as such in the summary.
`;
}

function buildRoastSystemPrompt() {
  return `
You are Doc in roast mode. You are lovingly roasting someone's overcomplicated or unrealistic itinerary or travel screenshot. You are kind but blunt. You still care about safety and sanity.

You must still return VALID JSON ONLY with the same shape as in plan mode, but the content can:
- Point out what's too much,
- Suggest a simpler alternative,
- Include a short, funny but kind "Doc verdict" in the summary.

Do NOT be cruel. Do NOT mock the traveller themself, only the chaos of the plan.

Use the same JSON keys:
title, summary, routes, stays, workspaces, dailyRhythm, safetyAndSanity, packingHints, amazonSearch, rawText.

In roast mode, dailyRhythm and safetyAndSanity must clearly say how to un-chaos the itinerary.
`;
}

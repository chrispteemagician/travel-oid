// netlify/functions/what3words.js
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const apiKey = process.env.W3W_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "W3W key not configured" }) };

  const { lat, lng } = event.queryStringParameters || {};
  if (!lat || !lng) return { statusCode: 400, headers, body: JSON.stringify({ error: "lat and lng required" }) };

  try {
    const res = await fetch(
      `https://api.what3words.com/v3/convert-to-3wa?coordinates=${lat},${lng}&language=en&key=${apiKey}`
    );
    const data = await res.json();
    if (data.words) {
      return { statusCode: 200, headers, body: JSON.stringify({ words: data.words }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ error: "No result" }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "w3w lookup failed" }) };
  }
};

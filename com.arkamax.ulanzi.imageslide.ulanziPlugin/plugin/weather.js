import { readFileSync } from "node:fs";
import sharp from "sharp";

export const WEATHER_REFRESH_MS = 30 * 60 * 1000;
export const WEATHER_RETRY_MS = 5 * 60 * 1000;
export const WEATHER_FORECAST_DAYS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;
const ICON_NAMES = ["clear-day","clear-night","partly-cloudy-day","partly-cloudy-night","overcast","rain","snow","thunderstorms","fog","not-available"];
const ICONS = new Map(ICON_NAMES.map((name) => [name, `data:image/png;base64,${readFileSync(new URL(`../resources/weather/${name}.png`, import.meta.url)).toString("base64")}`]));
const LANGUAGES = new Set(["ar","bn","bg","zh","cs","da","nl","fi","fr","de","el","hi","hu","it","ja","jv","ko","mr","pl","pt","pa","ro","ru","sr","si","sk","es","sv","ta","te","tr","uk","ur","vi","zu"]);

function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid weather ${field}.`);
  return number;
}

function text(value, field, maxLength = 100) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`Invalid weather ${field}.`);
  return value.trim();
}

export function weatherLanguage(locale = new Intl.DateTimeFormat().resolvedOptions().locale) {
  const normalized = String(locale || "").toLowerCase().replace("-", "_");
  if (normalized.startsWith("zh_tw") || normalized.startsWith("zh_hk")) return "zh_tw";
  const language = normalized.split("_", 1)[0];
  return LANGUAGES.has(language) ? language : "en";
}

export function normalizeWeatherResponse(payload) {
  const forecast = payload?.forecast?.forecastday;
  if (!Array.isArray(forecast) || forecast.length < WEATHER_FORECAST_DAYS) throw new Error("Weather forecast is incomplete.");
  const condition = payload?.current?.condition;
  const days = forecast.slice(0, WEATHER_FORECAST_DAYS).map((item) => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date) ? item.date : (() => { throw new Error("Invalid weather forecast date."); })(),
    minC: finite(item?.day?.mintemp_c, "minimum temperature"),
    maxC: finite(item?.day?.maxtemp_c, "maximum temperature"),
    minF: finite(item?.day?.mintemp_f, "minimum temperature"),
    maxF: finite(item?.day?.maxtemp_f, "maximum temperature"),
    rainChance: Math.max(0, Math.min(100, finite(item?.day?.daily_chance_of_rain, "rain chance"))),
    conditionCode: Math.trunc(finite(item?.day?.condition?.code, "condition code")),
  }));
  return {
    location: text(payload?.location?.name, "location"),
    country: text(payload?.location?.country, "country"),
    updatedEpoch: Math.trunc(finite(payload?.current?.last_updated_epoch, "update time")),
    tempC: finite(payload?.current?.temp_c, "temperature"),
    tempF: finite(payload?.current?.temp_f, "temperature"),
    feelsC: finite(payload?.current?.feelslike_c, "feels-like temperature"),
    feelsF: finite(payload?.current?.feelslike_f, "feels-like temperature"),
    humidity: Math.max(0, Math.min(100, finite(payload?.current?.humidity, "humidity"))),
    windKph: Math.max(0, finite(payload?.current?.wind_kph, "wind speed")),
    windMph: Math.max(0, finite(payload?.current?.wind_mph, "wind speed")),
    isDay: Number(payload?.current?.is_day) === 1,
    conditionText: text(condition?.text, "condition"),
    conditionCode: Math.trunc(finite(condition?.code, "condition code")),
    days,
  };
}

export async function fetchWeatherForecast({ apiKey, location, fetchImpl = globalThis.fetch, locale } = {}) {
  const url = new URL("https://api.weatherapi.com/v1/forecast.json");
  url.search = new URLSearchParams({ key: apiKey, q: location, days: String(WEATHER_FORECAST_DAYS), aqi: "no", alerts: "no", lang: weatherLanguage(locale) });
  let response, body;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    body = await response.text();
  } catch { throw new Error("Weather service is unreachable."); }
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("Weather response is too large.");
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error("Weather service returned invalid data."); }
  if (!response.ok) {
    const code = Number(payload?.error?.code);
    if (code === 1006) throw new Error("Weather location was not found.");
    if (code === 2006) throw new Error("WeatherAPI key is invalid.");
    if (code === 2007) throw new Error("WeatherAPI quota is exhausted.");
    throw new Error("Weather service rejected the request.");
  }
  return normalizeWeatherResponse(payload);
}

function iconName(code, isDay = true) {
  if (code === 1000) return isDay ? "clear-day" : "clear-night";
  if (code === 1003) return isDay ? "partly-cloudy-day" : "partly-cloudy-night";
  if ([1030,1135,1147].includes(code)) return "fog";
  if ([1087,1273,1276,1279,1282].includes(code)) return "thunderstorms";
  if ([1066,1069,1072,1114,1117,1204,1207,1210,1213,1216,1219,1222,1225,1237,1255,1258,1261,1264].includes(code)) return "snow";
  if ([1063,1150,1153,1168,1171,1180,1183,1186,1189,1192,1195,1198,1201,1240,1243,1246,1249,1252].includes(code)) return "rain";
  if ([1006,1009].includes(code)) return "overcast";
  return "not-available";
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function degrees(value) { return `${Math.round(value)}°`; }

export function createWeatherSlide(data, units = "c", locale = undefined, error = "") {
  const metric = units === "c", unit = metric ? "C" : "F";
  if (!data) {
    const message = error || "Configure WeatherAPI to show the forecast.";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="458" height="196" viewBox="0 0 458 196"><rect width="458" height="196" rx="16" fill="#172033"/><image href="${ICONS.get("not-available")}" x="25" y="36" width="110" height="110"/><text x="155" y="82" fill="#f8fafc" font-family="Arial, sans-serif" font-size="25" font-weight="700">Weather unavailable</text><text x="155" y="116" fill="#a8b7d1" font-family="Arial, sans-serif" font-size="15">${escapeXml(message.slice(0,42))}</text><text x="442" y="184" fill="#718096" font-family="Arial, sans-serif" font-size="10" text-anchor="end">WeatherAPI.com</text></svg>`;
    return { name:"weather", dataUri:`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, signature:`weather:unavailable:${message}` };
  }
  const temperature = metric ? data.tempC : data.tempF, feels = metric ? data.feelsC : data.feelsF, wind = metric ? `${Math.round(data.windKph)} km/h` : `${Math.round(data.windMph)} mph`, temperatureSize=Math.abs(temperature)>=100?34:44;
  const cards = data.days.map((day,index) => {
    const date = new Date(`${day.date}T12:00:00`), rawLabel = index === 0 ? new Intl.RelativeTimeFormat(locale,{numeric:"auto"}).format(0,"day") : new Intl.DateTimeFormat(locale,{weekday:"short"}).format(date), label=rawLabel.charAt(0).toUpperCase()+rawLabel.slice(1), min = metric ? day.minC : day.minF, max = metric ? day.maxC : day.maxF;
    const x=10+index*148;
    return `<g><rect x="${x}" y="53" width="142" height="135" rx="13" fill="#ffffff" fill-opacity=".08"/><text x="${x+71}" y="76" fill="#dbeafe" font-family="Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${escapeXml(label)}</text><image href="${ICONS.get(iconName(day.conditionCode,true))}" x="${x+36}" y="75" width="70" height="70"/><text x="${x+71}" y="163" fill="#f8fafc" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle">${degrees(max)} / ${degrees(min)}</text><text x="${x+71}" y="182" fill="#a8d4ff" font-family="Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle">Rain ${Math.round(day.rainChance)}%</text></g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="458" height="196" viewBox="0 0 458 196"><defs><linearGradient id="weather-bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#12213d"/><stop offset="1" stop-color="#224c72"/></linearGradient></defs><rect width="458" height="196" rx="16" fill="url(#weather-bg)"/><text x="14" y="31" fill="#f8fafc" font-family="Arial, sans-serif" font-size="19" font-weight="700">${escapeXml(data.location.slice(0,20))}</text><image href="${ICONS.get(iconName(data.conditionCode,data.isDay))}" x="145" y="3" width="44" height="44"/><text x="260" y="35" fill="#f8fafc" font-family="Arial, sans-serif" font-size="${Math.min(32,temperatureSize)}" font-weight="700" text-anchor="end">${degrees(temperature)}${unit}</text><text x="270" y="23" fill="#dbeafe" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(data.conditionText.slice(0,20))}</text><text x="270" y="43" fill="#b9d7f5" font-family="Arial, sans-serif" font-size="13" font-weight="700">Feels ${degrees(feels)} · ${Math.round(data.humidity)}% · ${escapeXml(wind)}</text><path d="M10 49H448" stroke="#ffffff" stroke-opacity=".14"/>${cards}<text x="450" y="195" fill="#8aa4c4" font-family="Arial, sans-serif" font-size="8" text-anchor="end">WeatherAPI.com</text></svg>`;
  const forecastSignature=data.days.map(day=>`${day.date}:${day.conditionCode}:${day.minC}:${day.maxC}`).join("|");
  return { name:"weather", dataUri:`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, signature:`weather:${units}:${data.updatedEpoch}:${forecastSignature}` };
}

export async function renderWeatherSlide(data, units = "c", locale = undefined, error = "") {
  const slide=createWeatherSlide(data,units,locale,error),svg=Buffer.from(slide.dataUri.split(",",2)[1],"base64");
  const png=await sharp(svg,{density:144}).resize(458,196).png({compressionLevel:9}).toBuffer();
  return {...slide,dataUri:`data:image/png;base64,${png.toString("base64")}`,signature:`rendered:${slide.signature}`};
}

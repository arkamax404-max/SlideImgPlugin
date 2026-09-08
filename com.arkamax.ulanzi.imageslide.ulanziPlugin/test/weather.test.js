import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { createWeatherSlide, fetchWeatherForecast, normalizeWeatherResponse, renderWeatherSlide, weatherLanguage } from "../plugin/weather.js";

function weatherPayload() {
  const forecastday=[
    ["2026-09-08",1003,16,24,61,75,35],
    ["2026-09-09",1183,14,21,57,70,70],
    ["2026-09-10",1000,15,25,59,77,5],
  ].map(([date,code,minC,maxC,minF,maxF,rain])=>({date,day:{mintemp_c:minC,maxtemp_c:maxC,mintemp_f:minF,maxtemp_f:maxF,daily_chance_of_rain:rain,condition:{code}}}));
  return {location:{name:"Madrid",country:"Spain"},current:{last_updated_epoch:1788858000,temp_c:22,temp_f:71.6,feelslike_c:22.5,feelslike_f:72.5,humidity:48,wind_kph:14,wind_mph:8.7,is_day:1,condition:{text:"Parcialmente nublado",code:1003}},forecast:{forecastday}};
}

test("WeatherAPI client uses HTTPS, free-plan forecast limits, locale, and bounded fields",async()=>{
  let requested;
  const fetchImpl=async(url)=>{requested=url;return{ok:true,text:async()=>JSON.stringify(weatherPayload())}};
  const weather=await fetchWeatherForecast({apiKey:"secret-key",location:"Madrid",locale:"es-ES",fetchImpl});
  assert.equal(requested.protocol,"https:");assert.equal(requested.hostname,"api.weatherapi.com");assert.equal(requested.pathname,"/v1/forecast.json");assert.equal(requested.searchParams.get("key"),"secret-key");assert.equal(requested.searchParams.get("q"),"Madrid");assert.equal(requested.searchParams.get("days"),"3");assert.equal(requested.searchParams.get("lang"),"es");
  assert.equal(weather.location,"Madrid");assert.equal(weather.days.length,3);assert.equal(weather.days[1].rainChance,70);assert.equal(weatherLanguage("zh-TW"),"zh_tw");assert.equal(weatherLanguage("xx-YY"),"en");
});

test("WeatherAPI errors are mapped without exposing provider messages",async()=>{
  await assert.rejects(fetchWeatherForecast({apiKey:"bad",location:"missing",fetchImpl:async()=>({ok:false,text:async()=>JSON.stringify({error:{code:2006,message:"private provider detail"}})})}),error=>error.message==="WeatherAPI key is invalid."&&!error.message.includes("private"));
  assert.throws(()=>normalizeWeatherResponse({forecast:{forecastday:[]}}),/incomplete/);
});

test("weather slide renders current conditions and three localized Meteocons forecast cards",async()=>{
  const data=normalizeWeatherResponse(weatherPayload()),slide=createWeatherSlide(data,"c","es-ES"),markup=Buffer.from(slide.dataUri.split(",",2)[1],"base64").toString("utf8");
  assert.match(markup,/width="458" height="196"/);assert.equal((markup.match(/width="142" height="135"/g)||[]).length,3);assert.match(markup,/font-size="20"/);assert.match(markup,/font-size="13" font-weight="700">Feels/);assert.match(markup,/font-size="18" font-weight="700" text-anchor="middle">Rain/);assert.match(markup,/Madrid/);assert.match(markup,/22°C/);assert.match(markup,/Hoy/);assert.match(markup,/Mié/);assert.equal((markup.match(/data:image\/png;base64/g)||[]).length,4);assert.match(markup,/WeatherAPI\.com/);
  const rendered=await sharp(Buffer.from(markup)).png().toBuffer({resolveWithObject:true});assert.equal(rendered.info.width,458);assert.equal(rendered.info.height,196);
  const flattened=await renderWeatherSlide(data,"c","es-ES");assert.match(flattened.dataUri,/^data:image\/png;base64,/);const metadata=await sharp(Buffer.from(flattened.dataUri.split(",",2)[1],"base64")).metadata();assert.equal(metadata.width,458);assert.equal(metadata.height,196);
  const unavailable=Buffer.from(createWeatherSlide(null,"c","en","Network unavailable").dataUri.split(",",2)[1],"base64").toString("utf8");assert.match(unavailable,/Weather unavailable/);assert.match(unavailable,/Network unavailable/);
});

test("vendored Meteocons retain their MIT license notice",()=>{
  const license=readFileSync(new URL("../resources/weather/LICENSE-METEOCONS.txt",import.meta.url),"utf8");assert.match(license,/MIT License/);assert.match(license,/Bas Milius/);assert.match(license,/2020-2024/);
});

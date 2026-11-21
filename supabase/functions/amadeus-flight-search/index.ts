import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const allowedOrigin="https://ssprvltd.github.io";
const cors={"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const recent=new Map<string,number[]>();
Deno.serve(async(req:Request)=>{
 const originHeader=req.headers.get("origin");
 if(originHeader&&originHeader!==allowedOrigin)return json({error:"Origin not allowed."},403);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown",now=Date.now();
 const calls=(recent.get(ip)||[]).filter(t=>now-t<60000);
 if(calls.length>=8)return json({error:"Too many searches. Please wait one minute."},429);
 calls.push(now);recent.set(ip,calls);
 const apiKey=Deno.env.get("AMADEUS_API_KEY"),apiSecret=Deno.env.get("AMADEUS_API_SECRET");
 if(!apiKey||!apiSecret)return json({error:"Amadeus Sandbox credentials are not configured.",code:"AMADEUS_CREDENTIALS_MISSING",required_secrets:["AMADEUS_API_KEY","AMADEUS_API_SECRET"],mode:"test"},503);
 let input:Record<string,unknown>;
 try{const v=await req.json();if(!v||typeof v!=="object"||Array.isArray(v))throw new Error();input=v as Record<string,unknown>;}catch{return json({error:"A JSON object is required."},400);}
 const origin=String(input.origin||"").trim().toUpperCase(),destination=String(input.destination||"").trim().toUpperCase(),departureDate=String(input.departureDate||"").trim(),returnDate=input.returnDate?String(input.returnDate).trim():"",adults=Number(input.adults??1);
 if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination)||origin===destination)return json({error:"Use valid 3-letter IATA airport/city codes."},400);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)||Number.isNaN(Date.parse(departureDate)))return json({error:"departureDate must be YYYY-MM-DD."},400);
 if(returnDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)||Number.isNaN(Date.parse(returnDate))||returnDate<=departureDate))return json({error:"returnDate must be after departureDate."},400);
 if(!Number.isInteger(adults)||adults<1||adults>9)return json({error:"adults must be from 1 to 9."},400);
 try{
  const tokenRes=await fetch("https://test.api.amadeus.com/v1/security/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:apiKey,client_secret:apiSecret}),signal:AbortSignal.timeout(15000)});
  const token=await tokenRes.json().catch(()=>({}));
  if(!tokenRes.ok||!token.access_token)return json({error:"Amadeus test authentication failed.",upstream_status:tokenRes.status},502);
  const p=new URLSearchParams({originLocationCode:origin,destinationLocationCode:destination,departureDate,adults:String(adults),currencyCode:"USD",max:"20"});if(returnDate)p.set("returnDate",returnDate);
  const res=await fetch("https://test.api.amadeus.com/v2/shopping/flight-offers?"+p.toString(),{headers:{Authorization:"Bearer "+token.access_token,Accept:"application/json"},signal:AbortSignal.timeout(25000)});
  const data=await res.json().catch(()=>({}));if(!res.ok)return json({error:"Amadeus test flight search failed.",upstream_status:res.status},502);
  return json({provider:"Amadeus",mode:"test",live_booking:false,...data});
 }catch{return json({error:"Could not reach Amadeus test API."},502);}
});
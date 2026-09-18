import React, { useState } from "react";
import ChallengeResult from "./ChallengeResult";

const BASE = { request:{scan_id:"SONAR-TEST-001",detection:{class_name:"Shipwreck",confidence:.91,bbox:[100,120,300,280]},decision:"incorrect_detection",expert_note:"The target appearance needs expert review.",corrected_class:"Aircraft"},response:{feedback:{feedback_id:101},audit:{audit_id:101}}};

export default function ChallengeResultTestPage(){
 const [result,setResult]=useState(BASE);
 const change=(decision,corrected_class=null)=>setResult({...BASE,request:{...BASE.request,decision,corrected_class}});
 return <main style={{minHeight:"100vh",padding:40,background:"#f1f5f9",boxSizing:"border-box"}}><div style={{maxWidth:1050,margin:"0 auto"}}>
   <ChallengeResult result={result}/>
   <div style={{marginTop:18,display:"flex",gap:10,flexWrap:"wrap"}}>
    <button onClick={()=>change("correct_detection",null)}>Test AI Confirmed</button>
    <button onClick={()=>change("incorrect_detection","Aircraft")}>Test AI Corrected</button>
    <button onClick={()=>change("unknown_anomaly",null)}>Test Unknown</button>
    <button onClick={()=>change("requires_further_sonar_inspection",null)}>Test Further Inspection</button>
   </div>
 </div></main>;
}

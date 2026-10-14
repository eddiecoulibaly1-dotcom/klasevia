import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const grades = ["CP1","CP2","CE1","CE2","CM1","CM2","6e","5e","4e","3e","Seconde","Première","Terminale"];
const subjects = ["Mathématiques","Français","SVT","Physique-Chimie","Histoire-Géographie","Anglais","Philosophie","Autre"];

function App() {
  const [grade, setGrade] = useState("3e");
  const [subject, setSubject] = useState("Mathématiques");
  const [mode, setMode] = useState("synthese");
  const [course, setCourse] = useState("");
  const [question, setQuestion] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function askAI() {
    const text = mode === "explication" ? question.trim() : course.trim();
    if (!text) { setError(mode === "explication" ? "Écris la notion qui te pose problème." : "Colle le texte du cours à travailler."); return; }
    setLoading(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/tutor", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({mode, grade, subject, difficulty, text})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "La demande n'a pas abouti.");
      setResult(data.answer || "Aucune réponse reçue. Réessaie.");
    } catch (e) {
      setError(e.message || "Connexion impossible. Vérifie ta connexion Internet et la configuration du serveur.");
    } finally { setLoading(false); }
  }

  async function speak() {
    if (!result || !("speechSynthesis" in window)) { setError("La lecture vocale n'est pas disponible sur ce navigateur."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result);
    utterance.lang = "fr-FR"; utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  }

  return <div className="app">
    <header className="top"><div className="brand"><div className="logo">K</div><div><b>Klasévia</b><small>Comprendre · S'exercer · Réussir</small></div></div><span className="country">Pensé pour les élèves de Côte d’Ivoire 🇨🇮</span></header>
    <main>
      <section className="hero"><div><div className="eyebrow">TON COMPAGNON D'ÉTUDE</div><h1>Ton cours devient<br/><em>plus clair.</em></h1><p>Une explication à la fois. Des exemples concrets. Des exercices pour vérifier que tu as compris — du primaire à la Terminale.</p><div className="chips"><span>📚 Fiches de révision</span><span>💡 Explications guidées</span><span>✍️ Exercices corrigés</span></div></div><div className="hero-art"><div className="book">✦</div><div className="floating f1">Je comprends !</div><div className="floating f2">+1 notion maîtrisée</div></div></section>
      <div className="workspace">
        <aside className="sidebar"><div className="side-title">MON ESPACE</div><button className={mode==="synthese"?"nav active":"nav"} onClick={()=>{setMode("synthese");setError("");}}>✦ <span>Synthétiser un cours</span></button><button className={mode==="explication"?"nav active":"nav"} onClick={()=>{setMode("explication");setError("");}}>💡 <span>Expliquer une notion</span></button><div className="side-note"><b>La méthode Klasévia</b><p>1. Comprends l'idée<br/>2. Observe un exemple<br/>3. Entraîne-toi<br/>4. Corrige tes erreurs</p></div><div className="privacy">Tes demandes sont envoyées au service IA configuré pour l'application. Évite d'entrer des informations personnelles.</div></aside>
        <section className="mainpanel">
          <div className="panel-heading"><div><div className="eyebrow dark">{mode==="synthese"?"FICHE DE RÉVISION":"EXPLICATION PAS À PAS"}</div><h2>{mode==="synthese"?"Transforme ta leçon":"Qu'est-ce qui te semble flou ?"}</h2><p>{mode==="synthese"?"L'IA repère les idées essentielles, définit les mots-clés et propose des exercices.":"L'IA adapte son explication à ta classe et utilise des exemples concrets."}</p></div><div className="spark">✳</div></div>
          <div className="formgrid"><label>Ma classe<select value={grade} onChange={e=>setGrade(e.target.value)}>{grades.map(g=><option key={g}>{g}</option>)}</select></label><label>Matière<select value={subject} onChange={e=>setSubject(e.target.value)}>{subjects.map(s=><option key={s}>{s}</option>)}</select></label><label className="wide">Niveau de détail<select value={difficulty} onChange={e=>setDifficulty(e.target.value)}><option value="simple">Très simple, avec des mots faciles</option><option value="normal">Détaillé, avec exemples</option><option value="approfondi">Approfondi, avec méthode et pièges fréquents</option></select></label>
          {mode==="synthese"?<label className="wide">Colle ton cours ici<textarea rows="7" value={course} onChange={e=>setCourse(e.target.value)} placeholder="Colle tes notes, le texte du manuel ou le passage difficile…"/></label>:<label className="wide">La notion que tu veux comprendre<input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ex. : résoudre une équation, la photosynthèse…"/></label>}</div>
          {error&&<div className="error" role="alert">{error}</div>}
          <button className="primary" onClick={askAI} disabled={loading}>{loading?<><span className="spinner"/> Klasévia réfléchit…</>:mode==="synthese"?"Créer ma fiche de cours →":"Expliquer cette notion →"}</button>
          {result&&<section className="answer"><div className="answer-top"><h3>✦ Ta réponse Klasévia</h3><button className="secondary" onClick={speak}>🔊 Écouter</button></div><div className="answer-body">{result.split("\n").map((line,i)=>line.trim()?<p key={i}>{line}</p>:<div key={i} className="smallgap"/>)}</div><button className="secondary" onClick={()=>{setCourse("");setQuestion("");setResult("");setError("");}}>Nouvelle leçon</button><p className="disclaimer">Vérifie les informations avec ton cours et les consignes de ton enseignant. L’IA peut faire des erreurs.</p></section>}
          <div className="tip"><span>🌱</span><div><b>Petit conseil</b><p>Après avoir lu la réponse, ferme ton cahier et explique la notion avec tes propres mots. C'est un excellent test de compréhension.</p></div></div>
        </section>
      </div>
      <footer>Klasévia · Prototype éducatif · Côte d’Ivoire <span>Une étape après l’autre, tu progresses.</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById("root")).render(<App />);

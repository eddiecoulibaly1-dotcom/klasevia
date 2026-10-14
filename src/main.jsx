
import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./style.css";

const grades = [
  "CP1", "CP2", "CE1", "CE2", "CM1", "CM2",
  "6e", "5e", "4e", "3e", "Seconde", "Première", "Terminale"
];

const subjects = [
  "Mathématiques", "Français", "SVT", "Physique-Chimie",
  "Histoire-Géographie", "Anglais", "Philosophie", "Autre"
];

const series = ["A", "C", "D"];

function App() {
  const [grade, setGrade] = useState("3e");
  const [serie, setSerie] = useState("D");
  const [subject, setSubject] = useState("Mathématiques");
  const [mode, setMode] = useState("synthese");
  const [course, setCourse] = useState("");
  const [question, setQuestion] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState(null);
  const [imageName, setImageName] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const recognitionRef = useRef(null);
  const utteranceRef = useRef(null);
  const speakQueueRef = useRef([]);
  const speakIndexRef = useRef(0);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  function stopSpeaking() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speakQueueRef.current = [];
    speakIndexRef.current = 0;
    utteranceRef.current = null;
    setSpeaking(false);
  }

  function cleanForSpeech(text) {
    return text
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
      .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/[*_~#]/g, " ")
      .replace(/\\(?:frac|sqrt|Delta|pi|times|neq|leq|geq|cdot|pm)\b/g, " ")
      .replace(/[{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function speakNext() {
    const queue = speakQueueRef.current;
    const index = speakIndexRef.current;

    if (index >= queue.length) {
      setSpeaking(false);
      utteranceRef.current = null;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(queue[index]);
    utterance.lang = "fr-FR";
    utterance.rate = 0.9;
    utterance.pitch = 1;

    utterance.onend = () => {
      speakIndexRef.current += 1;
      speakNext();
    };

    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") {
        return;
      }
      setSpeaking(false);
      setError(
        "La lecture vocale a rencontré un problème. Vérifie la synthèse vocale française dans les paramètres du téléphone."
      );
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function speak() {
    if (!result) {
      setError("Génère d'abord une réponse à écouter.");
      return;
    }

    if (!("speechSynthesis" in window)) {
      setError("La lecture vocale n'est pas disponible dans ce navigateur.");
      return;
    }

    stopSpeaking();
    setError("");

    const text = cleanForSpeech(result);
    if (!text) {
      setError("Il n'y a pas de texte lisible dans cette réponse.");
      return;
    }

    const sentences = text.match(/[^.!?;]+[.!?;]*/g) || [text];
    const chunks = [];
    let current = "";

    for (const sentence of sentences) {
      const part = sentence.trim();
      if (!part) continue;

      if ((current + " " + part).trim().length > 180) {
        if (current) chunks.push(current.trim());
        current = part;
      } else {
        current = (current + " " + part).trim();
      }
    }

    if (current) chunks.push(current.trim());

    speakQueueRef.current = chunks;
    speakIndexRef.current = 0;
    setSpeaking(true);
    speakNext();
  }

  function startVoiceInput() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        "La dictée vocale n'est pas disponible ici. Essaie Google Chrome ou utilise le micro du clavier de ton téléphone."
      );
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setListening(true);
      setError("");
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (mode === "explication") {
        setQuestion((previous) =>
          previous ? previous + " " + transcript : transcript
        );
      } else {
        setCourse((previous) =>
          previous ? previous + " " + transcript : transcript
        );
      }
    };

    recognition.onerror = () => {
      setError(
        "La dictée vocale a échoué. Vérifie l'autorisation du microphone ou utilise le micro du clavier."
      );
      setListening(false);
    };

    recognition.onend = () => setListening(false);

    try {
      recognition.start();
    } catch {
      setListening(false);
      setError("Impossible de démarrer le microphone. Réessaie.");
    }
  }

  function readImage(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Choisis un fichier image, par exemple JPG, PNG ou WEBP.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Cette image dépasse 8 Mo. Choisis une image plus légère.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) {
        setError("Impossible de lire cette image. Essaie une autre photo.");
        return;
      }

      setImage({
        data: dataUrl.slice(comma + 1),
        mimeType: file.type
      });
      setImageName(file.name || "Photo sélectionnée");
      setError("");
    };

    reader.onerror = () => {
      setError("La lecture de la photo a échoué. Réessaie.");
    };

    reader.readAsDataURL(file);
  }

  async function askAI() {
    const text =
      mode === "explication" ? question.trim() : course.trim();

    if (!text && !image) {
      setError(
        mode === "explication"
          ? "Écris ou dicte ta question, ou ajoute une photo."
          : "Colle ton cours, dicte-le ou ajoute une photo."
      );
      return;
    }

    stopSpeaking();
    setLoading(true);
    setError("");
    setResult("");

    try {
      const payload = {
        mode,
        grade,
        serie:
          grade === "Première" || grade === "Terminale"
            ? serie
            : "Tronc commun",
        subject,
        difficulty,
        text: text || "Analyse la photo jointe et aide-moi à comprendre son contenu."
      };

      if (image) {
        payload.image = image;
      }

      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "La demande n'a pas abouti.");
      }

      setResult(data.answer || "Aucune réponse reçue. Réessaie.");
    } catch (e) {
      setError(
        e.message ||
          "Connexion impossible. Vérifie Internet et la configuration du serveur."
      );
    } finally {
      setLoading(false);
    }
  }

  function newLesson() {
    stopSpeaking();
    setCourse("");
    setQuestion("");
    setImage(null);
    setImageName("");
    setResult("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo">K</div>
          <div>
            <b>Klasévia</b>
            <small>Comprendre · S'exercer · Réussir</small>
          </div>
        </div>
        <span className="country">
          Pensé pour les élèves de Côte d’Ivoire 🇨🇮
        </span>
      </header>

      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">TON COMPAGNON D'ÉTUDE</div>
            <h1>
              Ton cours devient
              <br />
              <em>plus clair.</em>
            </h1>
            <p>
              Des explications adaptées à ta classe, des exemples
              concrets et des exercices pour progresser du primaire
              à la Terminale.
            </p>
            <div className="chips">
              <span>📚 Fiches de révision</span>
              <span>💡 Explications guidées</span>
              <span>📷 Aide par photo</span>
            </div>
          </div>

          <div className="hero-art">
            <div className="book">✦</div>
            <div className="floating f1">Je comprends !</div>
            <div className="floating f2">+1 notion maîtrisée</div>
          </div>
        </section>

        <div className="workspace">
          <aside className="sidebar">
            <div className="side-title">MON ESPACE</div>

            <button
              className={mode === "synthese" ? "nav active" : "nav"}
              onClick={() => {
                setMode("synthese");
                setError("");
              }}
            >
              ✦ <span>Synthétiser un cours</span>
            </button>

            <button
              className={mode === "explication" ? "nav active" : "nav"}
              onClick={() => {
                setMode("explication");
                setError("");
              }}
            >
              💡 <span>Expliquer une notion</span>
            </button>

            <div className="side-note">
              <b>La méthode Klasévia</b>
              <p>
                1. Comprends l'idée
                <br />
                2. Observe un exemple
                <br />
                3. Entraîne-toi
                <br />
                4. Corrige tes erreurs
              </p>
            </div>

            <div className="privacy">
              Évite d'entrer des informations personnelles dans tes demandes.
            </div>
          </aside>

          <section className="mainpanel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow dark">
                  {mode === "synthese"
                    ? "FICHE DE RÉVISION"
                    : "EXPLICATION PAS À PAS"}
                </div>
                <h2>
                  {mode === "synthese"
                    ? "Transforme ta leçon"
                    : "Qu'est-ce qui te semble flou ?"}
                </h2>
                <p>
                  {mode === "synthese"
                    ? "Obtiens les idées essentielles, les définitions et des exercices."
                    : "Une explication adaptée à ta classe, avec des exemples concrets."}
                </p>
              </div>
              <div className="spark">✳</div>
            </div>

            <div className="formgrid">
              <label>
                Ma classe
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                >
                  {grades.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>

              <label>
                Matière
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {subjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              {(grade === "Première" || grade === "Terminale") && (
                <label>
                  Ma série
                  <select
                    value={serie}
                    onChange={(e) => setSerie(e.target.value)}
                  >
                    {series.map((s) => (
                      <option key={s} value={s}>Série {s}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="wide">
                Niveau de détail
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  <option value="simple">Très simple, avec des mots faciles</option>
                  <option value="normal">Détaillé, avec exemples</option>
                  <option value="approfondi">Approfondi, avec méthode et pièges fréquents</option>
                </select>
              </label>

              {mode === "synthese" ? (
                <label className="wide">
                  Colle ton cours ici
                  <textarea
                    rows="7"
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    placeholder="Colle tes notes ou décris la leçon à travailler…"
                  />
                </label>
              ) : (
                <label className="wide">
                  Ta question
                  <textarea
                    rows="4"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ex. : comment résoudre une équation ?"
                  />
                </label>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => fileRef.current?.click()}
              >
                📁 Choisir une photo
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => cameraRef.current?.click()}
              >
                📷 Prendre une photo
              </button>

              <button
                type="button"
                className="secondary"
                onClick={startVoiceInput}
                disabled={listening}
              >
                {listening ? "🎙️ Écoute en cours…" : "🎙️ Dicter"}
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => readImage(e.target.files?.[0])}
              />

              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => readImage(e.target.files?.[0])}
              />
            </div>

            {image && (
              <div style={{ marginTop: 12, padding: 12, background: "#f2f7f1", borderRadius: 12 }}>
                <p style={{ marginBottom: 8, fontSize: 12 }}>
                  📷 Photo prête : {imageName}
                </p>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt="Aperçu de la photo choisie"
                  style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 8 }}
                />
                <div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setImage(null);
                      setImageName("");
                    }}
                  >
                    Retirer la photo
                  </button>
                </div>
              </div>
            )}

            {error && <div className="error" role="alert">{error}</div>}

            <button
              className="primary"
              onClick={askAI}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" /> Klasévia réfléchit…
                </>
              ) : mode === "synthese" ? (
                "Créer ma fiche de cours →"
              ) : (
                "Expliquer cette notion →"
              )}
            </button>

            {result && (
              <section className="answer">
                <div className="answer-top">
                  <h3>✦ Ta réponse Klasévia</h3>
                  <button
                    className="secondary"
                    onClick={speaking ? stopSpeaking : speak}
                  >
                    {speaking ? "⏹ Arrêter" : "🔊 Écouter"}
                  </button>
                </div>

                <div className="answer-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {result}
                  </ReactMarkdown>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                  <button className="secondary" onClick={speak}>
                    🔁 Relire la réponse
                  </button>
                  <button className="secondary" onClick={newLesson}>
                    Nouvelle leçon
                  </button>
                </div>

                <p className="disclaimer">
                  Vérifie les informations avec ton cours et les consignes
                  de ton enseignant. L’IA peut faire des erreurs.
                </p>
              </section>
            )}

            <div className="tip">
              <span>🌱</span>
              <div>
                <b>Petit conseil</b>
                <p>
                  Après avoir lu la réponse, ferme ton cahier et explique
                  la notion avec tes propres mots.
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer>
          Klasévia · Prototype éducatif · Côte d’Ivoire
          <span>Une étape après l’autre, tu progresses.</span>
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

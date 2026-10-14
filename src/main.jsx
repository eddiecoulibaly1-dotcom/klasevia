
import React, { useState, useRef } from "react";
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
  const [speaking, setSpeaking] = useState(false);

  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const utteranceRef = useRef(null);

  const text =
    mode === "explication" ? question.trim() : course.trim();

  function chooseImage(file) {
    setError("");
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choisis une image JPG, PNG ou WebP.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("L'image dépasse 5 Mo. Choisis une image plus légère.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = reader.result;

      if (typeof dataUrl !== "string" || !dataUrl.includes(",")) {
        setError("Impossible de lire cette image. Réessaie.");
        return;
      }

      setImage({
        data: dataUrl.split(",")[1],
        mimeType: file.type,
        preview: dataUrl,
        name: file.name || "Photo de l'exercice"
      });
      setResult("");
    };

    reader.onerror = () => {
      setError("La lecture de l'image a échoué. Réessaie.");
    };

    reader.readAsDataURL(file);
  }

  async function askAI() {
    if (!text && !image) {
      setError(
        mode === "explication"
          ? "Écris une question ou ajoute une image."
          : "Colle ton cours ou ajoute une image."
      );
      return;
    }

    stopSpeaking();
    setLoading(true);
    setError("");
    setResult("");

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          grade,
          serie:
            grade === "Première" || grade === "Terminale"
              ? serie
              : "Tronc commun",
          subject,
          difficulty,
          text,
          image: image
            ? { data: image.data, mimeType: image.mimeType }
            : undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "La demande n'a pas abouti.");
      }

      setResult(data.answer || "Aucune réponse reçue. Réessaie.");
    } catch (e) {
      setError(
        e.message ||
          "Connexion impossible. Vérifie ta connexion Internet."
      );
    } finally {
      setLoading(false);
    }
  }

  function makeSpeakable(source) {
    return source
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
      .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/\\(?:frac|sqrt|Delta|pi|times|div|neq|leq|geq|cdot|text|mathrm|left|right)\b/g, " ")
      .replace(/[{}$#*_`>\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function speak() {
    if (!result.trim()) {
      setError("Aucune réponse à écouter.");
      return;
    }

    if (!("speechSynthesis" in window) ||
        typeof window.SpeechSynthesisUtterance === "undefined") {
      setError(
        "La lecture vocale n'est pas prise en charge ici. Essaie d'ouvrir Klasévia dans Chrome."
      );
      return;
    }

    const synth = window.speechSynthesis;
    const spokenText = makeSpeakable(result);

    if (!spokenText) {
      setError("Aucun texte lisible n'a été trouvé dans cette réponse.");
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = "fr-FR";
    utterance.rate = 0.88;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voices = synth.getVoices();
    const frenchVoice = voices.find(
      (v) => v.lang && v.lang.toLowerCase().startsWith("fr")
    );

    if (frenchVoice) {
      utterance.voice = frenchVoice;
    }

    utterance.onstart = () => {
      setSpeaking(true);
      setError("");
    };

    utterance.onend = () => {
      setSpeaking(false);
      utteranceRef.current = null;
    };

    utterance.onerror = (event) => {
      setSpeaking(false);
      utteranceRef.current = null;

      if (event.error !== "canceled" && event.error !== "interrupted") {
        setError(
          "La lecture vocale a échoué (" +
          event.error +
          "). Vérifie le moteur vocal de ton téléphone puis réessaie."
        );
      }
    };

    utteranceRef.current = utterance;
    setError("");

    try {
      synth.resume();
      synth.speak(utterance);
      setSpeaking(true);
    } catch (e) {
      setSpeaking(false);
      setError("Impossible de démarrer la lecture vocale. Réessaie.");
    }
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeaking(false);
  }

  function resetLesson() {
    stopSpeaking();
    setCourse("");
    setQuestion("");
    setImage(null);
    setResult("");
    setError("");
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
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
            <h1>Ton cours devient<br /><em>plus clair.</em></h1>
            <p>
              Une explication à la fois. Des exemples concrets.
              Des exercices pour vérifier que tu as compris —
              du primaire à la Terminale.
            </p>
            <div className="chips">
              <span>📚 Fiches de révision</span>
              <span>💡 Explications guidées</span>
              <span>✍️ Exercices corrigés</span>
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
                stopSpeaking();
                setMode("synthese");
                setError("");
              }}
            >
              ✦ <span>Synthétiser un cours</span>
            </button>

            <button
              className={mode === "explication" ? "nav active" : "nav"}
              onClick={() => {
                stopSpeaking();
                setMode("explication");
                setError("");
              }}
            >
              💡 <span>Expliquer une notion</span>
            </button>

            <div className="side-note">
              <b>La méthode Klasévia</b>
              <p>
                1. Comprends l'idée<br />
                2. Observe un exemple<br />
                3. Entraîne-toi<br />
                4. Corrige tes erreurs
              </p>
            </div>

            <div className="privacy">
              Tes demandes sont envoyées au service IA configuré
              pour l'application. Évite d'entrer des informations personnelles.
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
                    ? "L'IA repère les idées essentielles, définit les mots-clés et propose des exercices."
                    : "L'IA adapte son explication à ta classe et utilise des exemples concrets."}
                </p>
              </div>
              <div className="spark">✳</div>
            </div>

            <div className="formgrid">
              <label>
                Ma classe
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  {grades.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>

              <label>
                Matière
                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                  {subjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              {(grade === "Première" || grade === "Terminale") && (
                <label>
                  Ma série
                  <select value={serie} onChange={(e) => setSerie(e.target.value)}>
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
                    placeholder="Colle tes notes, le texte du manuel ou le passage difficile…"
                  />
                </label>
              ) : (
                <label className="wide">
                  La notion que tu veux comprendre
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ex. : résoudre une équation, la photosynthèse…"
                  />
                </label>
              )}
            </div>

            <section className="image-tools">
              <h3>📷 Ajouter un exercice en image</h3>
              <p>
                Prends une photo de ton cahier ou choisis une image
                pour que Klasévia lise et analyse son contenu.
              </p>

              <div className="image-buttons">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => cameraInput.current?.click()}
                >
                  📸 Prendre une photo
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => fileInput.current?.click()}
                >
                  🖼️ Choisir une image
                </button>
              </div>

              <input
                ref={cameraInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                hidden
                onChange={(e) => {
                  chooseImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />

              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  chooseImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />

              {image && (
                <div className="selected-image">
                  <img
                    src={image.preview}
                    alt="Aperçu de l'exercice à analyser"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: "320px",
                      objectFit: "contain",
                      borderRadius: "12px",
                      marginTop: "12px"
                    }}
                  />
                  <p>{image.name}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setImage(null)}
                  >
                    Retirer l'image
                  </button>
                </div>
              )}
            </section>

            {error && <div className="error" role="alert">{error}</div>}

            <button
              className="primary"
              onClick={askAI}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" /> Klasévia analyse…
                </>
              ) : image ? (
                "Analyser l'image et répondre →"
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
                    type="button"
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

                <button className="secondary" onClick={resetLesson}>
                  Nouvelle leçon
                </button>

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
                  la notion avec tes propres mots. C'est un excellent test
                  de compréhension.
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

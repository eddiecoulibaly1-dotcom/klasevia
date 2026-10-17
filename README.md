# Klasévia V59

Application éducative intelligente pour les élèves de Côte d’Ivoire, du primaire à la Terminale.

## V59 — Historique cloud React ↔ Supabase

V59 prolonge V58 avec un véritable historique de conversations lié au compte élève.

### Ce qui est ajouté

- historique des conversations dans `public.student_conversations` ;
- isolation par élève avec RLS ;
- synchronisation automatique React → Supabase après modification ;
- récupération des conversations cloud lors de la connexion ;
- fusion de l’historique local et cloud selon la date de modification ;
- suppression synchronisée d'une conversation ;
- bouton « Actualiser & synchroniser » ;
- fonctionnement hors connexion conservé via `localStorage` ;
- aucune clé `service_role` ou secret dans le navigateur.

### Structure cloud V59

La table `student_conversations` conserve les métadonnées de conversation et les messages dans `context.messages` en JSONB. L'accès est limité à l'utilisateur authentifié correspondant à `student_id`.

### Variables Vercel recommandées

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Le fallback vers le projet Klasévia est conservé pour faciliter le pilote. La clé utilisée dans le navigateur est une clé publishable.

### Développement

```bash
npm install
npm run dev
```

### Production

```bash
npm run build
```

Puis déployer le contenu du projet sur Vercel. Les secrets IA restent côté `/api` et ne doivent jamais être déplacés dans le navigateur.

## Sécurité

Les conversations sont protégées par Postgres RLS. La documentation Supabase recommande d'activer RLS sur les tables exposées et de définir les grants et policies correspondant précisément aux opérations de l'application.

## Important

V59 ne crée pas de compte élève dans l'interface publique. Les comptes restent provisionnés selon le modèle d'administration Klasévia.


## V61
Ajout du tuteur pédagogique guidé et de la prise en compte de la compétence suivie.

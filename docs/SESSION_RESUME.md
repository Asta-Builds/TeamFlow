# 🔄 TeamFlow Session Resume & Context Checkpoint

**Session ID :** `e660e576-fe32-408b-8bbb-25211d1af28c`  
**Date :** 2026-08-25  
**CEO / Fondateur :** Abdelilah Dahou (`ceo@teamflow.dev`)  
**Dépôt GitHub :** [https://github.com/Asta-Builds/TeamFlow.git](https://github.com/Asta-Builds/TeamFlow.git) (branche `main`)

---

## 🧭 Comment Reprendre cette Session sur une Deuxième Machine

Sur votre deuxième machine :

### 1. Cloner / Mettre à jour le Dépôt
```bash
git clone https://github.com/Asta-Builds/TeamFlow.git
cd TeamFlow
git pull origin main
```

### 2. Démarrer la Plateforme avec Docker
```bash
docker compose up --build -d
```
- **Application Frontend :** [http://localhost:3000](http://localhost:3000) *(Connexion : `ceo@teamflow.dev` / `teamflow-demo-pw`)*
- **API Backend & Swagger :** [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/)
- **Observabilité Langfuse :** [http://localhost:3001](http://localhost:3001)

### 3. Reprendre la Session dans Antigravity / Hermes Agent
Pour reprendre exactement là où nous nous sommes arrêtés :
- Fournissez le fichier `docs/SESSION_RESUME.md` ou l'identifiant de session :
  ```text
  Session ID: e660e576-fe32-408b-8bbb-25211d1af28c
  ```

---

## 🏗️ État Complet des Travaux & Réalisations de la Session

### 1. Inférence Locale GPU & Modèles dans Ollama
- **GPU Hôte :** NVIDIA GeForce RTX 3060 (12 Go VRAM GDDR6, CUDA 13.1).
- **Modèles Configurés & Validés :**
  - 🏆 **`hermes3:8b` (4.7 Go) :** Modèle officiel Nous Research avec fenêtre de contexte native de **128 000 tokens (128K)** pour les agents et le tool-calling.
  - 💻 **`qwen2.5-coder:7b` (4.7 Go) :** Modèle spécialisé en code Python / Django / React, maintenu persistant en VRAM (`OLLAMA_KEEP_ALIVE: "-1"`) avec inférence sub-seconde (0.5s).
- **Nettoyage :** Modèles volumineux inutilisés supprimés pour laisser **7.1 Go de VRAM libre**.

### 2. Isolation Stricte des Dépôts Projets (`generated_projects/`)
- Les agents IA ne modifient **JAMAIS** le code de la plateforme hôte TeamFlow.
- Chaque projet utilisateur génère un dépôt Git autonome dans `generated_projects/<project_id>_<slug>/`.
- Les commits sont signés avec l'identité réelle de chaque agent spécialiste :
  - Backend: `Marcus Aurelius (AI) <backend1@teamflow.dev>`
  - Frontend: `Cleopatra (AI) <frontend1@teamflow.dev>`
  - Tech Lead: `Sarah Jenkins (AI) <lead@teamflow.dev>`

### 3. Flux de Communication Entre Agents en Direct (Live Stream)
- Bouton **« 📡 Flux de Communication »** dans la barre supérieure avec stream auto-sync (3.5s).
- Chaîne séquentielle complète déclenchable en 1 clic via le bouton **« ⚡ Flux Autonome »** :
  ```text
  Sarah Jenkins (Tech Lead) ➔ Marcus Aurelius (Backend) ➔ Cleopatra (Frontend) ➔ Alan Turing (QA) ➔ Sarah Jenkins (Merge main) ➔ Joan of Arc (DevOps)
  ```
- Cartes de discussion avec détection des passages de relais (`➔ @agent`) et affichage des diffs unifiés.

### 4. Contrats de Validation (Architecture Factory 'Missions')
- **Définition en amont du 'Terminé' (Definition of Done) :** 5 assertions indépendantes (`VC-1` à `VC-5`) définies avant toute écriture de code.
- **Validation Holistique par Alan Turing (QA) :** Évaluation de chaque clause, éliminant les tests auto-référentiels.
- **Score de Conformité au Contrat :** Jauge interactive de 0 à 100% dans le tiroir de ticket.

### 5. Résolution de Tous les Dysfonctionnements
- ✅ **Erreur 404 sur les projets :** Réassignation des projets à l'organisation active (`organization_id=1`).
- ✅ **Erreur Langfuse v4 :** Migration vers l'API moderne `create_event(...)` pour tracer chaque exécution d'agent.
- ✅ **Signature `merge_pull_request` :** Prise en charge des URLs de PR directes.
- ✅ **Limite de contexte Hermes Agent :** Déblocage dans `agent_init.py` et `model_metadata.py` pour supporter les modèles 32k et 128k.

---

## 📚 Suite Documentaire Synchronisée sur GitHub

1. [**`README.md`**](../README.md) : Présentation générale avec badges et démarrage rapide.
2. [**`docs/SPECIFICATION_FONCTIONNELLE.md`**](./SPECIFICATION_FONCTIONNELLE.md) : Spécification fonctionnelle complète validée par le CEO.
3. [**`docs/ARCHITECTURE.md`**](./ARCHITECTURE.md) : Architecture LangGraph, pgvector RAG et isolation des dépôts.
4. [**`docs/HOSTING_AND_DEPLOYMENT.md`**](./HOSTING_AND_DEPLOYMENT.md) : Guide d'hébergement Docker, pass-through GPU CUDA, SSL Nginx et Cloud.
5. [**`docs/API_AND_AGENT_WORKFLOW.md`**](./API_AND_AGENT_WORKFLOW.md) : Référence de l'API REST et de la chaîne autonome.

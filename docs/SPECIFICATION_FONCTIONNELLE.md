# 📋 TeamFlow — Spécification Fonctionnelle Détaillée

**Plateforme :** TeamFlow (gestion de projets & tickets internes)  
**CEO / Fondateur :** Abdelilah Dahou (`ceo@teamflow.dev`)  
**Stack :** Django REST Framework (backend) + Next.js 16 App Router (frontend) + LangGraph Multi-Agent Swarm

---

## 1. Vue d'ensemble

TeamFlow est la plateforme interne de la Virtual Tech Company. Elle permet à l'équipe (Tech Lead, développeurs backend/frontend, DevOps, QA, designer UI/UX, spécialiste SEO) de gérer les projets, les tickets, les déploiements et le suivi SEO dans un seul outil, avec une vue globale pour le CEO.

---

## 2. Rôles & Permissions

| Rôle | Accès Dashboard | Créer Projet | Créer/Assigner Ticket | Modifier Statut Ticket | Déployer | Voir Audits SEO | Gérer Membres |
|---|---|---|---|---|---|---|---|
| **CEO** | Vue globale (tous projets) | Oui | Non (lecture seule) | Non | Non | Oui | Oui |
| **Tech Lead** | Oui | Oui | Oui | Oui | Non (valide seulement) | Oui | Oui (ajout/rôles) |
| **Backend / Frontend Dev** | Ses tickets uniquement | Non | Non (peut commenter) | Oui (ses tickets assignés) | Non | Non | Non |
| **DevOps** | Oui (section déploiements) | Non | Non | Non | Oui | Non | Non |
| **QA** | Oui (tickets "à tester") | Non | Non | Oui (valider/rejeter) | Non | Non | Non |
| **UI/UX Designer** | Oui (specs design) | Non | Non | Non | Non | Non | Non |
| **SEO Specialist** | Oui (section SEO) | Non | Non | Non | Non | Oui (crée/lance) | Non |

---

## 3. Module — Authentification & Comptes

### Fonctionnalités
- Inscription par email + mot de passe (validation format email, mot de passe ≥ 8 caractères)
- Connexion via Google (OAuth)
- Connexion par email/mot de passe avec JWT (access + refresh token)
- Déconnexion (invalidation du refresh token)
- Réinitialisation de mot de passe par email (lien à expiration 30 min)
- Vérification d'email à l'inscription
- Gestion de session : expiration automatique après inactivité (configurable, ex. 7 jours)

### Règles métier
- Un compte est créé avec un rôle par défaut « en attente » ; le Tech Lead ou le CEO doit valider et assigner le rôle final.
- Un utilisateur désactivé ne peut plus se connecter mais son historique (tickets, commentaires) reste visible.

---

## 4. Module — Dashboard

### Fonctionnalités
- Cartes de synthèse : nombre de projets actifs, tickets ouverts, tickets assignés à l'utilisateur connecté, derniers déploiements
- Fil d'activité en temps réel (création de ticket, changement de statut, commentaire, déploiement)
- Filtrage du fil d'activité par projet ou par type d'événement
- Vue personnalisée selon le rôle :
  - **CEO** : vue globale multi-projets, indicateurs de progression, budget/risques signalés par le Tech Lead
  - **Tech Lead** : vue des tickets à réviser (pull requests), blocages signalés
  - **Développeur** : mes tickets en cours, mes tickets en attente de review
  - **QA** : tickets « prêt pour QA »
  - **DevOps** : statut des derniers déploiements, alertes de monitoring
  - **SEO** : score SEO global, pages à corriger

---

## 5. Module — Gestion des Projets

### Fonctionnalités
- Création d'un projet (nom, description, date de début, propriétaire)
- Liste des projets en mode grille ou tableau, avec badge de statut (Actif / En pause / Terminé / Archivé)
- Barre de progression calculée automatiquement (tickets terminés / total tickets)
- Archivage d'un projet (lecture seule, n'apparaît plus dans les vues actives)
- Page de détail projet : résumé, membres assignés, liens vers le board Kanban, historique des déploiements liés

### Règles métier
- Seuls le CEO et le Tech Lead peuvent créer ou archiver un projet.
- Un projet archivé ne peut plus recevoir de nouveaux tickets.

---

## 6. Module — Kanban / Tickets

### Fonctionnalités
- Board Kanban par projet avec colonnes : **À faire**, **En cours**, **En revue**, **QA**, **Terminé**
- Glisser-déposer des cartes entre colonnes (avec règles de transition)
- Carte de ticket : titre, avatar de l'assigné, étiquette de priorité (Basse/Moyenne/Haute/Critique), type (Feature/Bug/Tâche)
- Filtres : par assigné, par priorité, par type, par étiquette
- Création rapide de ticket depuis le board (titre + colonne cible)
- Vue « Mes tickets » transverse à tous les projets

### Règles métier / Workflow de statut
- Un ticket ne peut passer en **QA** que s'il a une pull request liée et validée par le Tech Lead.
- Un ticket ne peut passer en **Terminé** que si le QA a validé (statut « QA validé »).
- Si QA rejette, le ticket retourne automatiquement en **En cours** avec un commentaire obligatoire expliquant le rejet.
- Seul l'assigné, le Tech Lead ou le CEO peuvent changer manuellement le statut d'un ticket (sauf transition automatique QA).

---

## 7. Module — Détail Ticket

### Fonctionnalités
- Titre, description (formatage riche : listes, liens, code)
- Champs : statut, priorité, type, assigné, projet parent, date d'échéance
- Pièces jointes (images, fichiers)
- Fil de commentaires avec horodatage et auteur
- Historique des changements (statut, assigné, priorité) affiché en bas du ticket
- Lien vers la pull request GitHub associée (si applicable)
- Notifications automatiques à l'assigné et au créateur lors d'un commentaire ou changement de statut

---

## 8. Module — Gestion d'Équipe

### Fonctionnalités
- Liste des membres avec avatar, nom, rôle (Tech Lead, Backend, Frontend, DevOps, QA, Design, SEO, CEO), statut (actif/hors-ligne/désactivé)
- Fiche membre : projets assignés, charge de travail actuelle (nombre de tickets ouverts)
- Ajout / suppression d'un membre (Tech Lead ou CEO uniquement)
- Modification du rôle d'un membre (CEO ou Tech Lead uniquement)
- Historique des contributions (tickets fermés, pull requests, déploiements) par membre

---

## 9. Module — Déploiements

### Fonctionnalités
- Liste des déploiements avec : projet, environnement (staging/production), déclenché par, statut (En cours/Réussi/Échoué/Annulé), horodatage
- Détail d'un déploiement : logs de build, durée, commit/branche déployée
- Déclenchement manuel d'un déploiement (DevOps uniquement)
- Rollback en un clic vers le déploiement précédent réussi
- Alertes automatiques (email/notification) en cas d'échec de déploiement
- Intégration CI/CD (GitHub Actions) : déploiement automatique après merge sur `main` (staging), déploiement manuel validé pour `production`

### Règles métier
- Un déploiement en production nécessite que tous les tickets du sprint soient en statut **Terminé** et que QA ait signé.
- Seul le rôle DevOps peut déclencher ou annuler un déploiement.

---

## 10. Module — SEO

### Fonctionnalités
- Lancement d'un audit technique sur une URL donnée (vitesse, métadonnées, structure des balises, données structurées)
- Historique des audits avec score global et liste des problèmes détectés, classés par sévérité
- Suivi des mots-clés et du trafic organique (intégration avec un outil externe type Search Console)
- Recommandations priorisées transmises automatiquement aux agents Frontend/DevOps concernés
- Rapport mensuel synthétique envoyé au Tech Lead et au CEO

---

## 11. Module — Paramètres & Intégrations

### Fonctionnalités
- Profil utilisateur (nom, avatar, email, mot de passe)
- Préférences de notification (email, in-app, fréquence)
- Paramètres du workspace (nom de la société, logo, fuseau horaire) — CEO/Tech Lead uniquement
- Gestion des intégrations (GitHub, Slack, Google Search Console)
- Export des données (projets, tickets) au format CSV/JSON

---

## 12. Intégration Slack (Section 11bis)

### Endpoints API (Django)
| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/api/integrations/slack/install/` | Démarre le flux OAuth Slack |
| GET | `/api/integrations/slack/callback/` | Callback OAuth, stocke le bot token |
| POST | `/api/integrations/slack/disconnect/` | Révoque et supprime le token |
| POST | `/api/integrations/slack/events/` | Récepteur Events API (réactions, slash commands) |
| GET | `/api/integrations/slack/channels/` | Liste les canaux |

### Routage des notifications
- **Ticket assigné :** DM à l'assigné
- **Déploiement échoué :** Canal `#devops` (mention DevOps + Tech Lead)
- **QA rejette un ticket :** DM à l'assigné + Tech Lead
- **Score SEO en baisse :** Canal `#seo`
- **Nouveau membre :** Annonce dans `#general`
- **Commande slash `/ticket` :** Création directe depuis Slack

---

## 13. Couche d'Autorisation — Permit.io (Section 14)

TeamFlow intègre **Permit.io** pour remplacer les règles statiques par des politiques dynamiques **RBAC, ABAC et ReBAC** (avec PDP sidecar local ou cloud).
- **Ressources :** `Project`, `Task`, `Deployment`, `SEOAudit`, `Member`, `SlackIntegration`
- **Actions :** `create`, `read`, `update`, `archive`, `assign`, `change_status`, `trigger`, `rollback`
- **ReBAC :** Propriété de la tâche (`Task.assignee == user`)
- **Access Requests & Approvals :** Demandes d'élévation de privilèges approuvables en 1 clic.

---

## 14. Suite des Écrans (1 à 9)

1. **Connexion / Inscription** (`/login`, `/register`)
2. **Dashboard** (`/dashboard`)
3. **Liste des Projets** (`/projects`)
4. **Détail Projet & Board Kanban** (`/projects/[id]`)
5. **Détail Ticket & Swarm Stream** (Tiroir interactif)
6. **Gestion d'Équipe** (`/team`)
7. **Déploiements & CI/CD** (`/deployments`)
8. **Audits SEO** (`/seo`)
9. **Paramètres Workspace** (`/settings`)

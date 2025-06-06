# lambda-sunset-image-uploader

Fonction AWS Lambda pour automatiser l’upload et l’association d’images produits sur WooCommerce à partir d’un bucket S3.

## Fonctionnalités

- Déclenchée par un upload d’image dans un bucket S3.
- Associe automatiquement les images au bon produit WooCommerce (via SKU).
- Upload les images sur WordPress/WooCommerce et les lie au produit.
- Supprime les images du bucket après traitement.

## Déploiement automatique (CI/CD)

Le déploiement sur AWS Lambda est automatisé via GitHub Actions à chaque push sur la branche `main`.

### Prérequis

- Un utilisateur IAM avec les droits Lambda (et S3 si besoin).
- Les secrets suivants doivent être ajoutés dans les paramètres GitHub du dépôt :
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`

### Variables d’environnement Lambda

Configurez les variables d’environnement suivantes dans la console AWS Lambda :

- `WOOCOMMERCE_API_URL` : URL de votre site WooCommerce (ex : https://monsite.com)
- `WOOCOMMERCE_CONSUMER_KEY` : Clé API WooCommerce
- `WOOCOMMERCE_CONSUMER_SECRET` : Secret API WooCommerce
- `WP_USER` : Identifiant WordPress (pour l’upload d’images)
- `WP_PASS` : Mot de passe WordPress (pour l’upload d’images)

### Dépendances

- aws-sdk
- axios
- csv-parser

Installées automatiquement lors du déploiement.

### Structure du projet

- `index.js` : Code principal de la Lambda
- `config.js` : Configuration des accès WooCommerce/WordPress via variables d’environnement
- `deploy.sh` : Script de déploiement manuel (optionnel, le CI/CD est recommandé)
- `.github/workflows/deploy.yml` : Déploiement automatique via GitHub Actions

### Déclencheur

La Lambda doit être reliée à un bucket S3 (événement "ObjectCreated") pour fonctionner.

---

## Déploiement manuel (optionnel)

```bash
npm ci
./deploy.sh
```

---

## Aide

Pour toute question ou amélioration, ouvrez une issue ou contactez le mainteneur.

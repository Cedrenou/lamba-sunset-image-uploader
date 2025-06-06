#!/bin/bash

# ⚠️ Vérifiez que vous êtes bien sur le bon profil AWS avant de déployer !
# Utilise la fonction Lambda de votre compte perso : lambda-sunset-upload-product-image

# Nom de ta Lambda
FUNCTION_NAME="lambda-sunset-upload-product-image"

# Nom de l'archive
ZIP_FILE="lambda-package.zip"

echo "🔄 Installation des dépendances propres (npm ci)..."
npm ci

if [ $? -ne 0 ]; then
    echo "❌ Échec de l'installation des dépendances."
    exit 1
fi


# Liste des fichiers et dossiers à inclure dans le zip
FILES="index.js config.js package.json node_modules"

echo "🗜️  Compression du code..."
zip -r $ZIP_FILE $FILES

if [ $? -ne 0 ]; then
    echo "❌ Échec de la création de l'archive."
    exit 1
fi

echo "🚀 Déploiement vers Lambda ($FUNCTION_NAME)..."
aws lambda update-function-code --function-name $FUNCTION_NAME --zip-file fileb://$ZIP_FILE > /dev/null && echo "✅ Code déployé avec succès."

if [ $? -ne 0 ]; then
    echo "❌ Échec du déploiement."
    exit 1
fi

echo "✅ Déploiement terminé avec succès."

# Nettoyage de l'archive
rm $ZIP_FILE


const AWS = require("aws-sdk");
const axios = require("axios");
const s3 = new AWS.S3();
const config = require("./config");

exports.handler = async (event) => {
    try {
        const record = event.Records[0];
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        if (key.startsWith("images/traite/") || key.startsWith("images/traité/")) {
            console.log("⏩ Fichier déjà traité, on ignore :", key);
            return;
        }

        const fileName = key.split("/").pop();
        const extension = fileName.split(".").pop().toLowerCase();

        if (!["jpg", "jpeg", "png"].includes(extension)) {
            console.log("📂 Fichier ignoré (pas une image JPG/PNG) :", fileName);
            return;
        }

        // ✅ N'exécute la Lambda que si le fichier est du type "SKU.jpg" sans suffixe
        const baseNameSansExtension = fileName.replace(/\.[^/.]+$/, "");
        const isImagePrincipale = !baseNameSansExtension.includes("-") && !baseNameSansExtension.includes("_");

        if (!isImagePrincipale) {
            console.log("⏩ Image secondaire ignorée :", fileName);
            return;
        }

        const baseSku = fileName.replace(/\.[^/.]+$/, "").split(/[_\-]/)[0].trim();
        console.log("🔍 SKU détecté :", baseSku);

        // 🔎 Récupérer le produit via SKU
        const searchProduct = await axios.get(`${config.woocommerceUrl}/wp-json/wc/v3/products`, {
            auth: {
                username: config.woocommerceKey,
                password: config.woocommerceSecret
            },
            params: { sku: baseSku }
        });

        if (!searchProduct.data.length) {
            console.warn("❗ Produit introuvable pour le SKU :", baseSku);
            return;
        }

        const product = searchProduct.data[0];
        console.log("✅ Produit trouvé :", product.name, "(ID:", product.id, ")");

        // 🗑️ Supprimer les anciennes images du produit
        if (product.images && product.images.length > 0) {
            console.log(`🗑️ Suppression de ${product.images.length} ancienne(s) image(s) du produit`);
            
            for (const oldImage of product.images) {
                try {
                    // Supprimer l'image de la bibliothèque média WordPress
                    await axios.delete(
                        `${config.woocommerceUrl}/wp-json/wp/v2/media/${oldImage.id}?force=true`,
                        {
                            headers: {
                                Authorization: `Basic ${Buffer.from(`${config.wpUser}:${config.wpPass}`).toString("base64")}`
                            }
                        }
                    );
                    console.log(`🗑️ Ancienne image supprimée (ID: ${oldImage.id})`);
                } catch (deleteError) {
                    console.warn(`⚠️ Impossible de supprimer l'ancienne image (ID: ${oldImage.id}):`, deleteError.response?.data || deleteError.message);
                }
            }
        }

        // 🧠 Fonction pour extraire les métadonnées Yoast SEO
        const getYoastMetadata = (product) => {
            const metaData = product.meta_data || [];
            const yoastTitle = metaData.find(meta => meta.key === '_yoast_wpseo_title')?.value;
            const yoastDesc = metaData.find(meta => meta.key === '_yoast_wpseo_metadesc')?.value;
            
            return {
                title: yoastTitle || product.name, // Fallback sur le nom du produit si pas de titre Yoast
                description: yoastDesc || `Image du produit ${product.name} (SKU: ${baseSku})` // Fallback sur une description basique
            };
        };

        // 🧠 Fonction pour créer un nom de fichier SEO-friendly
        const createSeoFileName = (productName, sku, extension, isSecondary = false, secondaryIndex = null) => {
            // Convertir en minuscules et remplacer les caractères spéciaux par des tirets
            const seoName = productName
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Enlever les accents
                .replace(/[^a-z0-9]+/g, '-') // Remplacer les caractères spéciaux par des tirets
                .replace(/^-+|-+$/g, ''); // Enlever les tirets au début et à la fin
            
            // Ajouter le SKU et éventuellement un suffixe pour les images secondaires
            const suffix = isSecondary ? `-vue-${secondaryIndex}` : '';
            return `${seoName}-${sku}${suffix}.${extension}`;
        };

        // 📁 Lister toutes les images commençant par ce SKU
        const listed = await s3.listObjectsV2({
            Bucket: bucket,
            Prefix: "images/"
        }).promise();

        const matchingImages = listed.Contents.filter(obj =>
            obj.Key.startsWith(`images/${baseSku}`)
            && !obj.Key.startsWith("images/traite/")
        );

        if (!matchingImages.length) {
            console.warn("📂 Aucune image trouvée pour le SKU :", baseSku);
            return;
        }

        // 🧠 Fonction de priorité
        const getPriority = (key) => {
            const name = key.toLowerCase();

            if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
                if (/-2/.test(name)) return 2;
                if (/-3/.test(name)) return 3;
                if (/-4/.test(name)) return 4;
                if (/-5/.test(name)) return 5;
                if (/-6/.test(name)) return 6;
                if (/-7/.test(name)) return 7;
                if (/-8/.test(name)) return 8;
                if (/-9/.test(name)) return 9;
                if (!name.includes("-") && !name.includes("_")) return 1; // 36.png
            }

            return 99; // tout le reste en dernier
        };

        // 🔁 Trie les images selon la priorité définie
        matchingImages.sort((a, b) => {
            const pA = getPriority(a.Key);
            const pB = getPriority(b.Key);
            return pA - pB;
        });

        const mediaIds = [];

        for (const imageObj of matchingImages) {
            const currentKey = imageObj.Key;
            const currentFileName = currentKey.split("/").pop();
            const currentExtension = currentFileName.split(".").pop().toLowerCase();

            // 🔽 Télécharger l'image
            const imageData = await s3.getObject({ Bucket: bucket, Key: currentKey }).promise();
            const buffer = imageData.Body;

            // 🏷️ Créer le nouveau nom de fichier SEO-friendly
            const isSecondary = currentFileName.includes("-");
            const secondaryIndex = isSecondary ? currentFileName.match(/-(\d+)/)?.[1] : null;
            const seoFileName = createSeoFileName(product.name, baseSku, currentExtension, isSecondary, secondaryIndex);
            console.log(`📝 Nouveau nom de fichier SEO : ${seoFileName} (original: ${currentFileName})`);

            // 📤 Uploader sur WordPress avec le nouveau nom
            const mediaRes = await axios.post(`${config.woocommerceUrl}/wp-json/wp/v2/media`, buffer, {
                headers: {
                    "Content-Disposition": `attachment; filename="${seoFileName}"`,
                    "Content-Type": `image/${currentExtension}`,
                    Authorization: `Basic ${Buffer.from(`${config.wpUser}:${config.wpPass}`).toString("base64")}`
                }
            });

            const mediaId = mediaRes.data.id;
            console.log(`🖼️ Image uploadée (${seoFileName}), ID : ${mediaId}`);
            mediaIds.push({ id: mediaId });

            // 📝 Récupérer les métadonnées Yoast SEO
            const yoastMetadata = getYoastMetadata(product);
            console.log("📊 Métadonnées Yoast SEO récupérées :", yoastMetadata);

            // 📝 Mettre à jour le titre de l'image sur WordPress
            await axios.post(
              `${config.woocommerceUrl}/wp-json/wp/v2/media/${mediaId}`,
              {
                title: yoastMetadata.title,
                alt_text: yoastMetadata.title, // Utilise le même titre Yoast pour l'alt text
                description: yoastMetadata.description
              },
              {
                headers: {
                  Authorization: `Basic ${Buffer.from(`${config.wpUser}:${config.wpPass}`).toString("base64")}`
                }
              }
            );

            // ✅ Image traitée avec succès - le nettoyage sera géré automatiquement par AWS
            console.log(`✅ Image ${currentFileName} traitée et uploadée sur WordPress`);
        }

        // 🔗 Associer toutes les images au produit
        await axios.put(
            `${config.woocommerceUrl}/wp-json/wc/v3/products/${product.id}`,
            { images: mediaIds },
            {
                auth: {
                    username: config.woocommerceKey,
                    password: config.woocommerceSecret
                }
            }
        );

        console.log("🔗 Toutes les images associées au produit :", product.name);

    } catch (error) {
        console.error("❌ Erreur dans la Lambda d'upload image :", error.response?.data || error.message);
        throw error;
    }
};

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

            // 📤 Uploader sur WordPress
            const mediaRes = await axios.post(`${config.woocommerceUrl}/wp-json/wp/v2/media`, buffer, {
                headers: {
                    "Content-Disposition": `attachment; filename="${currentFileName}"`,
                    "Content-Type": `image/${currentExtension}`,
                    Authorization: `Basic ${Buffer.from(`${config.wpUser}:${config.wpPass}`).toString("base64")}`
                }
            });

            const mediaId = mediaRes.data.id;
            console.log(`🖼️ Image uploadée (${currentFileName}), ID : ${mediaId}`);
            mediaIds.push({ id: mediaId });

            // 📁 Déplacer l'image dans /traite/
            const destinationKey = currentKey.replace("images/", "images/traite/");
            await s3.copyObject({
                Bucket: bucket,
                CopySource: encodeURIComponent(`${bucket}/${currentKey}`),
                Key: destinationKey
            }).promise();

            await s3.deleteObject({
                Bucket: bucket,
                Key: currentKey
            }).promise();

            console.log("📁 Image déplacée dans 'images/traite/' :", destinationKey);
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

/**
 * CULTURE MARKET — Admin
 * Authentification Supabase + CRUD simple sur toutes les tables.
 * Toutes les écritures passent par les policies RLS "admin full access"
 * définies dans supabase/schema.sql (accès réservé aux comptes authentifiés).
 */
(function () {
  const toastEl = document.getElementById("toast");
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function sb() {
    return window.supabaseClient;
  }

  function money(n) {
    return Math.round(n || 0).toLocaleString("fr-FR") + " FC";
  }

  // ---------------------------------------------------------------
  // AUTHENTIFICATION
  // ---------------------------------------------------------------
  const loginScreen = document.getElementById("login-screen");
  const adminScreen = document.getElementById("admin-screen");

  async function checkSession() {
    if (!window.CULTURE_SUPABASE_READY) {
      toast("Configuration Supabase manquante — voir js/config.js");
      return;
    }
    const { data } = await sb().auth.getSession();
    if (data.session) {
      showAdmin();
    } else {
      loginScreen.style.display = "block";
      adminScreen.style.display = "none";
    }
  }

  function showAdmin() {
    loginScreen.style.display = "none";
    adminScreen.style.display = "block";
    loadAll();
  }

  document.getElementById("btn-login").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = "block";
      return;
    }
    errEl.style.display = "none";
    showAdmin();
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await sb().auth.signOut();
    location.reload();
  });

  // ---------------------------------------------------------------
  // ONGLETS
  // ---------------------------------------------------------------
  document.querySelectorAll(".admin-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.panel).classList.add("active");
    });
  });

  // ---------------------------------------------------------------
  // DONNÉES PARTAGÉES
  // ---------------------------------------------------------------
  let categories = [];

  async function loadAll() {
    const { data: cats } = await sb().from("categories").select("*").order("ordre");
    categories = cats || [];
    await Promise.all([
      loadCategories(),
      loadProducts(),
      loadZones(),
      loadPayments(),
      loadOrders(),
      loadSettings(),
    ]);
  }

  // ---------------------------------------------------------------
  // PRODUITS
  // ---------------------------------------------------------------
  async function loadProducts() {
    const { data, error } = await sb().from("products").select("*").order("ordre");
    if (error) return toast("Erreur chargement produits");
    const tbody = document.querySelector("#table-products tbody");
    tbody.innerHTML = "";
    (data || []).forEach((p) => tbody.appendChild(productRow(p)));
  }

  function productRow(p) {
    const tr = document.createElement("tr");
    const catOptions = categories
      .map((c) => `<option value="${c.id}" ${c.id === p.category_id ? "selected" : ""}>${c.nom}</option>`)
      .join("");
    tr.innerHTML = `
      <td><input value="${p.nom || ""}" data-f="nom" /></td>
      <td><select data-f="category_id">${catOptions}</select></td>
      <td><input value="${p.unite || ""}" data-f="unite" style="width:80px;" /></td>
      <td><input type="number" value="${p.prix_fc || 0}" data-f="prix_fc" style="width:90px;" /></td>
      <td>
        <div class="admin-img-cell">
          <img class="admin-thumb" src="${p.image_url || '../images/placeholder.svg'}" alt="" data-thumb />
          <input value="${p.image_url || ""}" data-f="image_url" placeholder="URL de l'image" />
          <label class="mini-btn upload">
            Choisir une photo
            <input type="file" accept="image/*" data-file-input hidden />
          </label>
          <span class="upload-status" data-upload-status></span>
        </div>
      </td>
      <td style="text-align:center;"><input type="checkbox" data-f="disponible" ${p.disponible ? "checked" : ""} /></td>
      <td><input type="number" value="${p.ordre || 0}" data-f="ordre" style="width:60px;" /></td>
      <td class="actions">
        <button class="mini-btn save">Enregistrer</button>
        <button class="mini-btn delete">Suppr.</button>
      </td>
    `;
    tr.querySelector(".save").addEventListener("click", async () => {
      const payload = readRow(tr, ["nom", "unite", "image_url"], ["prix_fc", "category_id", "ordre"], ["disponible"]);
      const { error } = await sb().from("products").update(payload).eq("id", p.id);
      toast(error ? "Erreur d'enregistrement" : "Produit enregistré");
    });
    tr.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Supprimer "${p.nom}" ?`)) return;
      const { error } = await sb().from("products").delete().eq("id", p.id);
      if (!error) tr.remove();
      toast(error ? "Erreur de suppression" : "Produit supprimé");
    });

    // Aperçu en direct si on colle une URL à la main
    const urlInput = tr.querySelector('[data-f="image_url"]');
    const thumb = tr.querySelector("[data-thumb]");
    urlInput.addEventListener("input", () => {
      thumb.src = urlInput.value || "../images/placeholder.svg";
    });

    // Upload direct d'une photo vers Supabase Storage (bucket "produits")
    const fileInput = tr.querySelector("[data-file-input]");
    const statusEl = tr.querySelector("[data-upload-status]");
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast("Merci de choisir un fichier image.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast("Photo trop lourde (5 Mo maximum).");
        return;
      }

      statusEl.textContent = "Envoi en cours...";
      try {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `produits/${p.id}-${Date.now()}.${ext}`;

        const { error: upErr } = await sb()
          .storage.from("produits")
          .upload(path, file, { upsert: true, cacheControl: "3600" });
        if (upErr) throw upErr;

        const { data: pub } = sb().storage.from("produits").getPublicUrl(path);
        const publicUrl = pub.publicUrl;

        const { error: updErr } = await sb()
          .from("products")
          .update({ image_url: publicUrl })
          .eq("id", p.id);
        if (updErr) throw updErr;

        urlInput.value = publicUrl;
        thumb.src = publicUrl;
        statusEl.textContent = "Photo enregistrée.";
        toast("Photo envoyée et enregistrée.");
      } catch (err) {
        console.error(err);
        const msg = (err && err.message) || "";
        if (msg.toLowerCase().includes("bucket not found")) {
          statusEl.textContent = "Bucket manquant.";
          toast('Le stockage "produits" n\'existe pas encore — voir supabase/storage.sql dans le GUIDE.');
        } else {
          statusEl.textContent = "Erreur d'envoi.";
          toast("Erreur lors de l'envoi de la photo.");
        }
      } finally {
        fileInput.value = "";
      }
    });

    return tr;
  }

  document.getElementById("btn-add-product").addEventListener("click", async () => {
    const { data, error } = await sb()
      .from("products")
      .insert({ nom: "Nouveau produit", unite: "kg", prix_fc: 0, category_id: categories[0]?.id || null })
      .select()
      .single();
    if (error) return toast("Erreur de création");
    document.querySelector("#table-products tbody").appendChild(productRow(data));
  });

  function readRow(tr, textFields, numberFields, checkFields) {
    const payload = {};
    textFields.forEach((f) => {
      payload[f] = tr.querySelector(`[data-f="${f}"]`).value;
    });
    numberFields.forEach((f) => {
      payload[f] = parseFloat(tr.querySelector(`[data-f="${f}"]`).value) || 0;
    });
    checkFields.forEach((f) => {
      payload[f] = tr.querySelector(`[data-f="${f}"]`).checked;
    });
    return payload;
  }

  // ---------------------------------------------------------------
  // CATEGORIES
  // ---------------------------------------------------------------
  async function loadCategories() {
    const tbody = document.querySelector("#table-categories tbody");
    tbody.innerHTML = "";
    categories.forEach((c) => tbody.appendChild(categoryRow(c)));
  }

  function categoryRow(c) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${c.nom || ""}" data-f="nom" /></td>
      <td><input value="${c.slug || ""}" data-f="slug" /></td>
      <td><input type="number" value="${c.ordre || 0}" data-f="ordre" style="width:60px;" /></td>
      <td class="actions">
        <button class="mini-btn save">Enregistrer</button>
        <button class="mini-btn delete">Suppr.</button>
      </td>
    `;
    tr.querySelector(".save").addEventListener("click", async () => {
      const payload = readRow(tr, ["nom", "slug"], ["ordre"], []);
      const { error } = await sb().from("categories").update(payload).eq("id", c.id);
      toast(error ? "Erreur d'enregistrement" : "Catégorie enregistrée");
    });
    tr.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Supprimer "${c.nom}" ? Les produits associés resteront mais sans catégorie.`)) return;
      const { error } = await sb().from("categories").delete().eq("id", c.id);
      if (!error) { tr.remove(); await loadAll(); }
      toast(error ? "Erreur de suppression" : "Catégorie supprimée");
    });
    return tr;
  }

  document.getElementById("btn-add-category").addEventListener("click", async () => {
    const nom = prompt("Nom de la nouvelle catégorie ?");
    if (!nom) return;
    const slug = nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
    const { error } = await sb().from("categories").insert({ nom, slug });
    if (error) return toast("Erreur de création (slug déjà utilisé ?)");
    await loadAll();
  });

  // ---------------------------------------------------------------
  // ZONES DE LIVRAISON
  // ---------------------------------------------------------------
  async function loadZones() {
    const { data, error } = await sb().from("delivery_zones").select("*").order("ordre");
    if (error) return toast("Erreur chargement zones");
    const tbody = document.querySelector("#table-zones tbody");
    tbody.innerHTML = "";
    (data || []).forEach((z) => tbody.appendChild(zoneRow(z)));
  }

  function zoneRow(z) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${z.nom_commune || ""}" data-f="nom_commune" /></td>
      <td><input type="number" value="${z.frais_fc || 0}" data-f="frais_fc" style="width:90px;" /></td>
      <td style="text-align:center;"><input type="checkbox" data-f="actif" ${z.actif ? "checked" : ""} /></td>
      <td><input type="number" value="${z.ordre || 0}" data-f="ordre" style="width:60px;" /></td>
      <td class="actions">
        <button class="mini-btn save">Enregistrer</button>
        <button class="mini-btn delete">Suppr.</button>
      </td>
    `;
    tr.querySelector(".save").addEventListener("click", async () => {
      const payload = readRow(tr, ["nom_commune"], ["frais_fc", "ordre"], ["actif"]);
      const { error } = await sb().from("delivery_zones").update(payload).eq("id", z.id);
      toast(error ? "Erreur d'enregistrement" : "Zone enregistrée");
    });
    tr.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Supprimer la zone "${z.nom_commune}" ?`)) return;
      const { error } = await sb().from("delivery_zones").delete().eq("id", z.id);
      if (!error) tr.remove();
      toast(error ? "Erreur de suppression" : "Zone supprimée");
    });
    return tr;
  }

  document.getElementById("btn-add-zone").addEventListener("click", async () => {
    const { data, error } = await sb()
      .from("delivery_zones")
      .insert({ nom_commune: "Nouvelle zone", frais_fc: 0 })
      .select()
      .single();
    if (error) return toast("Erreur de création");
    document.querySelector("#table-zones tbody").appendChild(zoneRow(data));
  });

  // ---------------------------------------------------------------
  // MOYENS DE PAIEMENT
  // ---------------------------------------------------------------
  async function loadPayments() {
    const { data, error } = await sb().from("payment_methods").select("*").order("ordre");
    if (error) return toast("Erreur chargement paiements");
    const tbody = document.querySelector("#table-payments tbody");
    tbody.innerHTML = "";
    (data || []).forEach((m) => tbody.appendChild(paymentRow(m)));
  }

  function paymentRow(m) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${m.nom || ""}" data-f="nom" /></td>
      <td><input value="${m.instructions || ""}" data-f="instructions" style="min-width:220px;" /></td>
      <td style="text-align:center;"><input type="checkbox" data-f="actif" ${m.actif ? "checked" : ""} /></td>
      <td><input type="number" value="${m.ordre || 0}" data-f="ordre" style="width:60px;" /></td>
      <td class="actions">
        <button class="mini-btn save">Enregistrer</button>
        <button class="mini-btn delete">Suppr.</button>
      </td>
    `;
    tr.querySelector(".save").addEventListener("click", async () => {
      const payload = readRow(tr, ["nom", "instructions"], ["ordre"], ["actif"]);
      const { error } = await sb().from("payment_methods").update(payload).eq("id", m.id);
      toast(error ? "Erreur d'enregistrement" : "Moyen de paiement enregistré");
    });
    tr.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Supprimer "${m.nom}" ?`)) return;
      const { error } = await sb().from("payment_methods").delete().eq("id", m.id);
      if (!error) tr.remove();
      toast(error ? "Erreur de suppression" : "Moyen supprimé");
    });
    return tr;
  }

  document.getElementById("btn-add-payment").addEventListener("click", async () => {
    const { data, error } = await sb()
      .from("payment_methods")
      .insert({ nom: "Nouveau moyen de paiement", instructions: "" })
      .select()
      .single();
    if (error) return toast("Erreur de création");
    document.querySelector("#table-payments tbody").appendChild(paymentRow(data));
  });

  // ---------------------------------------------------------------
  // COMMANDES
  // ---------------------------------------------------------------
  const STATUTS = ["nouvelle", "confirmee", "en_livraison", "livree", "annulee"];

  async function loadOrders() {
    const { data, error } = await sb().from("orders").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) return toast("Erreur chargement commandes");
    const tbody = document.querySelector("#table-orders tbody");
    tbody.innerHTML = "";
    (data || []).forEach((o) => {
      const tr = document.createElement("tr");
      const date = new Date(o.created_at).toLocaleString("fr-FR");
      const options = STATUTS.map((s) => `<option value="${s}" ${s === o.statut ? "selected" : ""}>${s}</option>`).join("");
      tr.innerHTML = `
        <td>${o.numero}</td>
        <td>${o.nom_client}</td>
        <td>${o.telephone}</td>
        <td>${o.commune}</td>
        <td>${money(o.total_fc)}</td>
        <td><select data-f="statut">${options}</select></td>
        <td>${date}</td>
      `;
      tr.querySelector("select").addEventListener("change", async (e) => {
        const { error } = await sb().from("orders").update({ statut: e.target.value }).eq("id", o.id);
        toast(error ? "Erreur de mise à jour" : "Statut mis à jour");
      });
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------
  // RÉGLAGES DU SITE
  // ---------------------------------------------------------------
  const SETTINGS_LABELS = {
    nom_entreprise: "Nom affiché",
    slogan: "Slogan",
    description_accueil: "Description (page d'accueil)",
    ville: "Ville",
    horaires_livraison: "Horaires de livraison",
    commande_minimum_fc: "Commande minimum (FC)",
    responsable_nom: "Nom du responsable",
    responsable_role: "Rôle du responsable",
    telephone_contact: "Téléphone de contact",
    whatsapp_contact: "WhatsApp (format international, ex: 243970000000)",
    email_contact: "E-mail de contact",
    adresse_texte: "Adresse (texte affiché)",
    google_maps_url: "Lien Google Maps",
    facebook_url: "Lien Facebook",
    instagram_url: "Lien Instagram",
    tiktok_url: "Lien TikTok",
  };

  async function loadSettings() {
    const { data, error } = await sb().from("site_settings").select("*");
    if (error) return toast("Erreur chargement réglages");
    const map = {};
    (data || []).forEach((r) => (map[r.cle] = r.valeur));
    const grid = document.getElementById("settings-grid");
    grid.innerHTML = "";
    Object.entries(SETTINGS_LABELS).forEach(([key, label]) => {
      const l = document.createElement("label");
      l.textContent = label;
      const input = document.createElement("input");
      input.value = map[key] || "";
      input.dataset.key = key;
      grid.appendChild(l);
      grid.appendChild(input);
    });
  }

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const inputs = document.querySelectorAll("#settings-grid input");
    const rows = Array.from(inputs).map((i) => ({ cle: i.dataset.key, valeur: i.value }));
    const { error } = await sb().from("site_settings").upsert(rows, { onConflict: "cle" });
    toast(error ? "Erreur d'enregistrement" : "Réglages enregistrés");
  });

  checkSession();
})();

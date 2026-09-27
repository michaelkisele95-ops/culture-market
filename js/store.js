/**
 * CULTURE MARKET — Store
 * Couche de données : lecture du catalogue Supabase + gestion du panier
 * (le panier est conservé dans localStorage tant que la commande n'est
 * pas validée).
 */
const CultureStore = (function () {
  const CART_KEY = "culture_market_cart_v1";

  let cache = {
    categories: [],
    products: [],
    zones: [],
    paymentMethods: [],
    settings: {},
  };

  function sb() {
    if (!window.supabaseClient) {
      throw new Error("Supabase non configuré");
    }
    return window.supabaseClient;
  }

  // ---------------------------------------------------------------
  // CATALOGUE
  // ---------------------------------------------------------------
  async function loadCatalog() {
    if (!window.CULTURE_SUPABASE_READY) return cache;

    const [catRes, prodRes, zoneRes, payRes, setRes] = await Promise.all([
      sb().from("categories").select("*").order("ordre"),
      sb().from("products").select("*").eq("disponible", true).order("ordre"),
      sb().from("delivery_zones").select("*").eq("actif", true).order("ordre"),
      sb().from("payment_methods").select("*").eq("actif", true).order("ordre"),
      sb().from("site_settings").select("*"),
    ]);

    if (catRes.error) console.error(catRes.error);
    if (prodRes.error) console.error(prodRes.error);
    if (zoneRes.error) console.error(zoneRes.error);
    if (payRes.error) console.error(payRes.error);
    if (setRes.error) console.error(setRes.error);

    cache.categories = catRes.data || [];
    cache.products = prodRes.data || [];
    cache.zones = zoneRes.data || [];
    cache.paymentMethods = payRes.data || [];
    cache.settings = {};
    (setRes.data || []).forEach((row) => {
      cache.settings[row.cle] = row.valeur;
    });

    return cache;
  }

  function getSetting(key, fallback = "") {
    return cache.settings[key] || fallback;
  }

  function minOrder() {
    return parseFloat(getSetting("commande_minimum_fc", "22000")) || 0;
  }

  // ---------------------------------------------------------------
  // PANIER (localStorage)
  // ---------------------------------------------------------------
  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    document.dispatchEvent(new CustomEvent("cart:changed"));
  }

  function setQty(productId, qty) {
    const cart = readCart();
    if (qty <= 0) {
      delete cart[productId];
    } else {
      cart[productId] = qty;
    }
    writeCart(cart);
  }

  function getQty(productId) {
    return readCart()[productId] || 0;
  }

  function clearCart() {
    localStorage.removeItem(CART_KEY);
    document.dispatchEvent(new CustomEvent("cart:changed"));
  }

  function cartLines() {
    const cart = readCart();
    return Object.entries(cart)
      .map(([id, qty]) => {
        const product = cache.products.find((p) => String(p.id) === String(id));
        if (!product) return null;
        return {
          product,
          qty,
          sousTotal: product.prix_fc * qty,
        };
      })
      .filter(Boolean);
  }

  function cartTotal() {
    return cartLines().reduce((sum, l) => sum + l.sousTotal, 0);
  }

  function cartCount() {
    return cartLines().reduce((sum, l) => sum + l.qty, 0);
  }

  // ---------------------------------------------------------------
  // COMMANDE
  // ---------------------------------------------------------------
  async function submitOrder({ nom, telephone, commune, adresse, mode, fraisLivraison, moyenPaiement }) {
    const lines = cartLines();
    if (!lines.length) throw new Error("Panier vide");

    const sousTotal = cartTotal();
    const total = sousTotal + (fraisLivraison || 0);

    const { data: order, error: orderErr } = await sb()
      .from("orders")
      .insert({
        nom_client: nom,
        telephone,
        commune,
        adresse,
        mode_livraison: mode,
        frais_livraison: fraisLivraison || 0,
        sous_total_fc: sousTotal,
        total_fc: total,
        moyen_paiement: moyenPaiement,
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    const items = lines.map((l) => ({
      order_id: order.id,
      product_id: l.product.id,
      nom_produit: l.product.nom,
      unite: l.product.unite,
      prix_unitaire: l.product.prix_fc,
      quantite: l.qty,
      sous_total: l.sousTotal,
    }));

    const { error: itemsErr } = await sb().from("order_items").insert(items);
    if (itemsErr) throw itemsErr;

    clearCart();
    return order;
  }

  async function lookupOrders(telephone) {
    const { data, error } = await sb().rpc("get_orders_by_phone", {
      p_telephone: telephone,
    });
    if (error) throw error;
    return data || [];
  }

  async function lookupOrderItems(numero, telephone) {
    const { data, error } = await sb().rpc("get_order_items", {
      p_numero: numero,
      p_telephone: telephone,
    });
    if (error) throw error;
    return data || [];
  }

  return {
    loadCatalog,
    getSetting,
    minOrder,
    get categories() {
      return cache.categories;
    },
    get products() {
      return cache.products;
    },
    get zones() {
      return cache.zones;
    },
    get paymentMethods() {
      return cache.paymentMethods;
    },
    setQty,
    getQty,
    clearCart,
    cartLines,
    cartTotal,
    cartCount,
    submitOrder,
    lookupOrders,
    lookupOrderItems,
  };
})();

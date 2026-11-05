(function () {
    'use strict';

    const CONFIG = window.SHOP_CONFIG || {};
    const WHATSAPP_NUMBER = CONFIG.whatsapp || '';
    const STORE_NAME = CONFIG.storeName || 'Optom Product Osh';

    const CATEGORY_ICONS = {
        bakaleya: '🛍️',
        napitki: '🥤',
        sladosti: '🍫',
        molochnye: '🥛',
        konservy: '🥫',
        sneki: '🍿',
    };

    const CART_KEY = 'shop_cart_v1';
    const CUSTOMER_KEY = 'shop_customer_v1';

    const state = {
        products: [],
        categories: [],
        cart: loadCart(),
        customer: loadCustomer(),
        category: 'all',
        search: '',
        loading: true,
        error: null,
        submitting: false,
    };

    const dom = {
        products: document.getElementById('products'),
        productsCount: document.getElementById('productsCount'),
        categoryList: document.getElementById('categoryList'),
        cartItems: document.getElementById('cartItems'),
        cartCount: document.getElementById('cartCount'),
        total: document.getElementById('total'),
        orderBtn: document.getElementById('orderBtn'),
        cartOverlay: document.getElementById('cartOverlay'),
        searchInput: document.getElementById('searchInput'),
        customerName: document.getElementById('customerName'),
        customerPhone: document.getElementById('customerPhone'),
        toast: document.getElementById('toast'),
    };

    let toastTimeout = null;

    /* =========================
       STORAGE
    ========================= */

    function loadCart() {
        try {
            const raw = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
            const result = {};
            Object.keys(raw || {}).forEach(function (key) {
                const qty = parseInt(raw[key], 10);
                if (qty > 0) result[key] = qty;
            });
            return result;
        } catch (error) {
            return {};
        }
    }

    function saveCart() {
        localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    }

    function loadCustomer() {
        try {
            return JSON.parse(localStorage.getItem(CUSTOMER_KEY) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    function saveCustomer(customer) {
        state.customer = customer;
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    }

    /* =========================
       HELPERS
    ========================= */

    function esc(value) {
        return window.fmt.html(value);
    }

    function plural(number, forms) {
        const abs = Math.abs(number) % 100;
        const last = abs % 10;
        if (abs > 10 && abs < 20) return forms[2];
        if (last > 1 && last < 5) return forms[1];
        if (last === 1) return forms[0];
        return forms[2];
    }

    function getProduct(id) {
        return state.products.find(function (product) {
            return String(product.id) === String(id);
        });
    }

    function categoryIcon(slug) {
        return CATEGORY_ICONS[slug] || '📦';
    }

    function priceFor(product, quantity) {
        const wholesale = Number(product.wholesale_price);
        const threshold = Number(product.min_wholesale_qty) || 0;
        if (threshold > 0 && quantity >= threshold && wholesale > 0) {
            return wholesale;
        }
        return Number(product.retail_price);
    }

    function cartEntries() {
        return Object.keys(state.cart)
            .filter(function (id) { return state.cart[id] > 0; })
            .map(function (id) {
                const product = getProduct(id);
                if (!product) return null;
                const quantity = state.cart[id];
                const price = priceFor(product, quantity);
                return {
                    product: product,
                    quantity: quantity,
                    price: price,
                    total: price * quantity,
                };
            })
            .filter(Boolean);
    }

    function cartTotals() {
        return cartEntries().reduce(function (acc, entry) {
            acc.quantity += entry.quantity;
            acc.total += entry.total;
            return acc;
        }, { quantity: 0, total: 0 });
    }

    function syncCartWithStock() {
        let changed = false;
        Object.keys(state.cart).forEach(function (id) {
            const product = getProduct(id);
            if (!product || product.stock_quantity <= 0) {
                delete state.cart[id];
                changed = true;
                return;
            }
            if (state.cart[id] > product.stock_quantity) {
                state.cart[id] = product.stock_quantity;
                changed = true;
            }
        });
        if (changed) saveCart();
    }

    /* =========================
       API
    ========================= */

    async function loadData() {
        state.loading = true;
        state.error = null;
        renderProducts();
        dom.productsCount.textContent = 'Загрузка…';

        try {
            const results = await Promise.all([
                API.get('/categories/'),
                API.get('/products/'),
            ]);

            state.categories = Array.isArray(results[0]) ? results[0] : [];
            state.products = (Array.isArray(results[1]) ? results[1] : [])
                .filter(function (product) { return product.is_active; })
                .map(function (product) {
                    product.stock_quantity = Number(product.stock_quantity) || 0;
                    return product;
                });

            if (state.category !== 'all'
                && !state.categories.some(function (item) { return item.slug === state.category; })) {
                state.category = 'all';
            }

            syncCartWithStock();
            state.loading = false;

            renderCategories();
            renderProducts();
            renderCart();
        } catch (error) {
            state.loading = false;
            state.error = error.message;
            renderCategories();
            renderProducts();
            dom.productsCount.textContent = 'Ошибка загрузки';
        }
    }

    async function refreshProducts() {
        try {
            const products = await API.get('/products/');
            state.products = (Array.isArray(products) ? products : [])
                .filter(function (product) { return product.is_active; })
                .map(function (product) {
                    product.stock_quantity = Number(product.stock_quantity) || 0;
                    return product;
                });
            syncCartWithStock();
            renderProducts();
            renderCart();
        } catch (error) {
            /* тихо: заказ уже оформлен, витрина обновится при перезагрузке */
        }
    }

    /* =========================
       RENDER: CATEGORIES
    ========================= */

    function renderCategories() {
        const buttons = [
            '<button class="category' + (state.category === 'all' ? ' active' : '')
            + '" data-category="all">Все товары</button>',
        ];

        state.categories.forEach(function (category) {
            const active = state.category === category.slug ? ' active' : '';
            buttons.push(
                '<button class="category' + active + '" data-category="'
                + esc(category.slug) + '">'
                + categoryIcon(category.slug) + ' ' + esc(category.name)
                + '</button>'
            );
        });

        dom.categoryList.innerHTML = buttons.join('');
    }

    /* =========================
       RENDER: PRODUCTS
    ========================= */

    function renderSkeletons() {
        dom.products.innerHTML = new Array(8)
            .fill('<div class="skeleton-card"></div>')
            .join('');
    }

    function renderProducts() {
        if (state.loading) {
            dom.productsCount.textContent = 'Загрузка…';
            renderSkeletons();
            return;
        }

        if (state.error) {
            dom.productsCount.textContent = '—';
            dom.products.innerHTML = ''
                + '<div class="error-box">'
                + '<strong>Не удалось загрузить каталог</strong>'
                + esc(state.error)
                + '<br><button id="retryBtn">Повторить</button>'
                + '</div>';
            const retry = document.getElementById('retryBtn');
            if (retry) retry.addEventListener('click', loadData);
            return;
        }

        const search = state.search.toLowerCase().trim();

        const filtered = state.products.filter(function (product) {
            const categoryMatch = state.category === 'all'
                || product.category_slug === state.category;
            const searchMatch = !search
                || product.name.toLowerCase().includes(search)
                || String(product.category_name || '').toLowerCase().includes(search);
            return categoryMatch && searchMatch;
        });

        dom.productsCount.textContent = filtered.length + ' '
            + plural(filtered.length, ['товар', 'товара', 'товаров']);

        if (!filtered.length) {
            dom.products.innerHTML = ''
                + '<div class="empty-products">'
                + '<div style="font-size:44px;margin-bottom:10px">🔍</div>'
                + '<strong>Ничего не найдено</strong><br>'
                + 'Попробуйте изменить запрос или выбрать другую категорию.'
                + '</div>';
            return;
        }

        dom.products.innerHTML = filtered.map(function (product, index) {
            const quantity = state.cart[product.id] || 0;
            const stock = Number(product.stock_quantity) || 0;
            const outOfStock = stock <= 0;

            const retail = Number(product.retail_price);
            const wholesale = Number(product.wholesale_price);
            const minQty = Number(product.min_wholesale_qty) || 0;
            const hasWholesale = minQty > 0 && wholesale > 0 && wholesale < retail;

            let stockClass = '';
            let stockText = 'В наличии: ' + stock;
            if (outOfStock) {
                stockClass = ' out';
                stockText = 'Нет в наличии';
            } else if (stock < 5) {
                stockClass = ' low';
                stockText = 'Осталось: ' + stock;
            }

            const media = product.image_src
                ? '<span class="product-emoji">' + categoryIcon(product.category_slug) + '</span>'
                + '<img src="' + esc(product.image_src) + '" alt="' + esc(product.name)
                + '" loading="lazy" onerror="this.remove()">'
                : '<span class="product-emoji">' + categoryIcon(product.category_slug) + '</span>';

            let controls;
            if (quantity > 0) {
                controls = ''
                    + '<div class="quantity" style="display:flex">'
                    + '<button data-action="dec" data-id="' + product.id + '">−</button>'
                    + '<span>' + quantity + '</span>'
                    + '<button data-action="inc" data-id="' + product.id + '">+</button>'
                    + '</div>';
            } else {
                controls = ''
                    + '<button class="add-btn" data-action="add" data-id="' + product.id + '"'
                    + (outOfStock ? ' disabled title="Нет в наличии"' : ' title="Добавить в корзину"')
                    + '>+</button>';
            }

            return ''
                + '<article class="product" style="animation-delay:' + (index * 0.04) + 's">'
                + '<div class="product-image">'
                + media
                + '<span class="product-stock' + stockClass + '">' + stockText + '</span>'
                + '</div>'
                + '<div class="product-info">'
                + '<div class="product-category">' + esc(product.category_name) + '</div>'
                + '<div class="product-name">' + esc(product.name) + '</div>'
                + '<div class="product-bottom">'
                + '<div>'
                + '<div class="price">' + window.fmt.number(retail) + ' сом</div>'
                + '<div class="unit">за ' + esc(product.unit) + '</div>'
                + (hasWholesale
                    ? '<div class="wholesale-hint">Опт от ' + minQty + ' ' + esc(product.unit)
                        + ' — ' + window.fmt.number(wholesale) + ' сом</div>'
                    : '')
                + '</div>'
                + controls
                + '</div>'
                + '</div>'
                + '</article>';
        }).join('');
    }

    /* =========================
       RENDER: CART
    ========================= */

    function emptyCartMarkup() {
        return ''
            + '<div class="empty-cart">'
            + '<div>'
            + '<div class="empty-icon">🛒</div>'
            + '<strong>Корзина пока пустая</strong>'
            + '<p style="margin-top:8px">Добавьте товары из каталога, чтобы оформить заказ.</p>'
            + '</div>'
            + '</div>';
    }

    function renderCart() {
        const entries = cartEntries();
        const totals = cartTotals();

        dom.cartCount.textContent = totals.quantity;
        dom.total.textContent = window.fmt.money(totals.total);
        dom.orderBtn.disabled = !entries.length || state.submitting;
        dom.orderBtn.textContent = state.submitting ? 'Отправляем…' : 'Оформить заказ';

        if (!entries.length) {
            dom.cartItems.innerHTML = emptyCartMarkup();
            return;
        }

        dom.cartItems.innerHTML = entries.map(function (entry) {
            const product = entry.product;
            const isWholesale = entry.price < Number(product.retail_price);

            const image = product.image_src
                ? '<img src="' + esc(product.image_src) + '" alt="' + esc(product.name)
                    + '" onerror="this.remove()">'
                : categoryIcon(product.category_slug);

            return ''
                + '<div class="cart-item">'
                + '<div class="cart-item-image">' + image + '</div>'
                + '<div class="cart-item-info">'
                + '<div class="cart-item-name">' + esc(product.name) + '</div>'
                + '<div class="cart-item-price">' + window.fmt.money(entry.total)
                + '<small>' + entry.quantity + ' × ' + window.fmt.number(entry.price) + ' сом'
                + (isWholesale ? ' · опт' : '') + '</small>'
                + '</div>'
                + '<div class="cart-item-controls">'
                + '<button data-action="dec" data-id="' + product.id + '">−</button>'
                + '<strong>' + entry.quantity + '</strong>'
                + '<button data-action="inc" data-id="' + product.id + '">+</button>'
                + '</div>'
                + '</div>'
                + '</div>';
        }).join('');
    }

    /* =========================
       CART ACTIONS
    ========================= */

    function addToCart(id, button) {
        const product = getProduct(id);
        if (!product) return;

        const stock = Number(product.stock_quantity) || 0;
        const current = state.cart[id] || 0;

        if (stock <= 0) {
            showToast('Этого товара нет в наличии', true);
            return;
        }

        if (current >= stock) {
            showToast('На складе только ' + stock + ' ' + plural(stock, ['штука', 'штуки', 'штук']), true);
            return;
        }

        state.cart[id] = current + 1;
        saveCart();

        if (product.image_src) flyToCart(button, product.image_src);

        renderProducts();
        renderCart();
        showToast(product.name + ' добавлен в корзину');
    }

    function changeQuantity(id, amount) {
        const product = getProduct(id);
        if (!product) return;

        const current = state.cart[id] || 0;
        if (!current) return;

        const next = current + amount;
        const stock = Number(product.stock_quantity) || 0;

        if (next <= 0) {
            delete state.cart[id];
        } else if (next > stock) {
            showToast('Больше нет на складе: ' + stock + ' ' + product.unit, true);
            return;
        } else {
            state.cart[id] = next;
        }

        saveCart();
        renderProducts();
        renderCart();
    }

    function openCart() {
        renderCart();
        dom.cartOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        dom.customerName.value = state.customer.name || '';
        dom.customerPhone.value = state.customer.phone || '';
    }

    function closeCart() {
        dom.cartOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function overlayClick(event) {
        if (event.target === dom.cartOverlay) closeCart();
    }

    /* =========================
       ORDER
    ========================= */

    async function submitOrder() {
        if (state.submitting) return;

        const entries = cartEntries();
        if (!entries.length) return;

        const name = dom.customerName.value.trim();
        const phone = dom.customerPhone.value.trim();

        if (!name) {
            showToast('Укажите ваше имя', true);
            dom.customerName.focus();
            return;
        }
        if (phone.replace(/\D/g, '').length < 6) {
            showToast('Укажите корректный номер телефона', true);
            dom.customerPhone.focus();
            return;
        }

        saveCustomer({ name: name, phone: phone });

        const items = entries.map(function (entry) {
            return {
                product_id: entry.product.id,
                quantity: entry.quantity,
            };
        });

        state.submitting = true;
        renderCart();

        // Открываем окно заранее, чтобы браузер не заблокировал переход в WhatsApp
        const waWindow = window.open('about:blank', '_blank');

        try {
            const order = await API.post('/orders/', {
                items: items,
                customer_name: name,
                customer_phone: phone,
            });

            const message = buildWhatsAppMessage(order, name, phone);
            const waUrl = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);

            if (waWindow && !waWindow.closed) {
                waWindow.location.href = waUrl;
            } else {
                window.location.href = waUrl;
            }

            state.cart = {};
            saveCart();

            closeCart();
            showToast('Заказ №' + order.id + ' оформлен. Спасибо!');
            await refreshProducts();
            renderCart();
        } catch (error) {
            if (waWindow && !waWindow.closed) waWindow.close();
            showToast(error.message || 'Не удалось оформить заказ', true);
        } finally {
            state.submitting = false;
            renderCart();
        }
    }

    function buildWhatsAppMessage(order, name, phone) {
        let message = 'Здравствуйте! Заказ №' + order.id + ' — ' + STORE_NAME + '.\n\n';
        message += '🛒 *Состав заказа:*\n\n';

        (order.items || []).forEach(function (item, index) {
            message += (index + 1) + '. ' + item.product_name + '\n';
            message += '   ' + item.quantity + ' × ' + item.price_per_item
                + ' сом = ' + item.total + ' сом\n\n';
        });

        message += '💰 *Итого: ' + order.total_amount + ' сом*\n\n';
        message += '👤 ' + name + '\n';
        message += '📞 ' + phone;

        return message;
    }

    /* =========================
       ANIMATION
    ========================= */

    function flyToCart(button, imageSrc) {
        if (!button) return;

        const img = document.createElement('img');
        img.src = imageSrc;
        img.className = 'flying-product';
        img.alt = '';
        document.body.appendChild(img);

        const start = button.getBoundingClientRect();
        const cart = document.querySelector('.cart-button').getBoundingClientRect();

        img.style.left = start.left + 'px';
        img.style.top = start.top + 'px';

        requestAnimationFrame(function () {
            img.style.left = (cart.left + cart.width / 2) + 'px';
            img.style.top = (cart.top + cart.height / 2) + 'px';
            img.style.width = '15px';
            img.style.height = '15px';
            img.style.opacity = '0';
            img.style.transform = 'rotate(360deg) scale(.5)';
        });

        setTimeout(function () { img.remove(); }, 750);
    }

    /* =========================
       TOAST
    ========================= */

    function showToast(text, isError) {
        dom.toast.textContent = text;
        dom.toast.classList.toggle('error', !!isError);
        dom.toast.classList.add('show');

        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(function () {
            dom.toast.classList.remove('show');
        }, 3200);
    }

    /* =========================
       EVENTS
    ========================= */

    function bindEvents() {
        dom.searchInput.addEventListener('input', function (event) {
            state.search = event.target.value;
            renderProducts();
        });

        dom.categoryList.addEventListener('click', function (event) {
            const button = event.target.closest('.category');
            if (!button) return;
            state.category = button.dataset.category;
            renderCategories();
            renderProducts();
        });

        dom.products.addEventListener('click', function (event) {
            const button = event.target.closest('[data-action]');
            if (!button) return;

            const id = Number(button.dataset.id);
            const action = button.dataset.action;

            if (action === 'add') addToCart(id, button);
            if (action === 'inc') changeQuantity(id, 1);
            if (action === 'dec') changeQuantity(id, -1);
        });

        dom.cartItems.addEventListener('click', function (event) {
            const button = event.target.closest('[data-action]');
            if (!button) return;

            const id = Number(button.dataset.id);
            const action = button.dataset.action;

            if (action === 'inc') changeQuantity(id, 1);
            if (action === 'dec') changeQuantity(id, -1);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closeCart();
        });
    }

    /* =========================
       INIT
    ========================= */

    window.openCart = openCart;
    window.closeCart = closeCart;
    window.overlayClick = overlayClick;
    window.submitOrder = submitOrder;

    bindEvents();
    loadData();
})();

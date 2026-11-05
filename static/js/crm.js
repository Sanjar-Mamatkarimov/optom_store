(function () {
    'use strict';

    const CONFIG = window.CRM_CONFIG || {};

    const VIEW_META = {
        dashboard: {
            title: 'Обзор',
            subtitle: 'Ключевые показатели магазина',
        },
        products: {
            title: 'Товары',
            subtitle: 'Каталог, цены и складские остатки',
        },
        supply: {
            title: 'Поставка',
            subtitle: 'Приход товара и история движений',
        },
        orders: {
            title: 'Заказы',
            subtitle: 'Заказы клиентов и управление статусами',
        },
    };

    const STATUS_LABELS = {
        new: 'Новый',
        processing: 'В обработке',
        completed: 'Завершён',
        cancelled: 'Отменён',
    };

    const CATEGORY_ICONS = {
        bakaleya: '🛍️',
        napitki: '🥤',
        sladosti: '🍫',
        molochnye: '🥛',
        konservy: '🥫',
        sneki: '🍿',
    };

    const state = {
        view: 'dashboard',
        categories: [],
        products: [],
        supplyProducts: [],
        orders: [],
        ordersStatus: 'all',
        operationsType: 'all',
        productFilters: {
            search: '',
            category: 'all',
            includeInactive: false,
        },
        pendingSupplyId: null,
    };

    const dom = {};
    let toastTimeout = null;
    let searchTimeout = null;

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

    function categoryIcon(slug) {
        return CATEGORY_ICONS[slug] || '📦';
    }

    function statusBadge(status) {
        return '<span class="badge badge-' + esc(status) + '">'
            + esc(STATUS_LABELS[status] || status)
            + '</span>';
    }

    function showToast(text, isError) {
        dom.toast.textContent = text;
        dom.toast.classList.toggle('error', !!isError);
        dom.toast.classList.add('show');

        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(function () {
            dom.toast.classList.remove('show');
        }, 3500);
    }

    function handleError(error) {
        if (error && (error.status === 401 || error.status === 403)) {
            const next = encodeURIComponent(window.location.pathname + window.location.hash);
            window.location.href = CONFIG.loginUrl + '?next=' + next;
            return;
        }
        showToast((error && error.message) || 'Произошла ошибка', true);
    }

    function setButtonLoading(button, loading, loadingText) {
        if (!button) return;
        if (loading) {
            button.dataset.originalText = button.textContent;
            button.disabled = true;
            button.textContent = loadingText || 'Загрузка…';
        } else {
            button.disabled = false;
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    /* =========================
       NAVIGATION
    ========================= */

    async function switchView(view) {
        if (!VIEW_META[view]) view = 'dashboard';
        state.view = view;

        document.querySelectorAll('.nav-item').forEach(function (button) {
            button.classList.toggle('active', button.dataset.view === view);
        });

        document.querySelectorAll('.view').forEach(function (section) {
            section.classList.toggle('active', section.dataset.view === view);
        });

        dom.pageTitle.textContent = VIEW_META[view].title;
        dom.pageSubtitle.textContent = VIEW_META[view].subtitle;

        history.replaceState(null, '', '#' + view);

        if (view === 'dashboard') await loadDashboard();
        if (view === 'products') await loadProducts();
        if (view === 'supply') await loadSupplyData();
        if (view === 'orders') await loadOrders();
    }

    function loadCurrentView() {
        return switchView(state.view);
    }

    /* =========================
       DASHBOARD
    ========================= */

    async function loadDashboard() {
        try {
            const data = await API.get('/crm/dashboard/');
            renderDashboard(data);
        } catch (error) {
            handleError(error);
        }
    }

    function renderDashboard(data) {
        const metrics = data.metrics || {};

        dom.statRevenue.textContent = window.fmt.money(metrics.total_revenue);
        dom.statRevenueSub.textContent = 'Сегодня: ' + window.fmt.money(metrics.today_revenue);

        dom.statProfit.textContent = window.fmt.money(metrics.total_profit);
        dom.statProfitSub.textContent = 'Сегодня: ' + window.fmt.money(metrics.today_profit);

        dom.statOrders.textContent = window.fmt.number(metrics.orders_count);
        dom.statOrdersSub.textContent = 'Сегодня: ' + window.fmt.number(metrics.today_orders);

        dom.statAvg.textContent = window.fmt.money(metrics.avg_check);
        dom.statAvgSub.textContent = metrics.orders_count
            ? 'По ' + metrics.orders_count + ' ' + plural(metrics.orders_count, ['заказу', 'заказам', 'заказам'])
            : 'Пока нет заказов';

        dom.statusChips.innerHTML = (data.statuses || []).map(function (status) {
            return ''
                + '<button class="chip status-' + esc(status.value) + '" data-status="' + esc(status.value) + '">'
                + '<span class="dot"></span>'
                + esc(status.label)
                + ' <strong>' + status.count + '</strong>'
                + '</button>';
        }).join('');

        renderChart(data.sales_chart || []);
        renderLowStock(data.low_stock || []);
        renderRecentOrders(data.recent_orders || []);
        renderTopProducts(data.top_products || []);
    }

    function renderChart(points) {
        const max = points.reduce(function (acc, point) {
            return Math.max(acc, Number(point.revenue) || 0);
        }, 0);

        if (!points.length || max <= 0) {
            dom.salesChart.innerHTML = '<div class="chart-empty">За последние 30 дней продаж не было</div>';
            return;
        }

        dom.salesChart.innerHTML = points.map(function (point) {
            const revenue = Number(point.revenue) || 0;
            const height = Math.max(4, Math.round((revenue / max) * 100));
            const date = new Date(point.date + 'T00:00:00');
            const label = isNaN(date.getTime())
                ? point.date
                : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

            return ''
                + '<div class="chart-col" title="' + esc(label) + ': ' + esc(window.fmt.money(revenue)) + '">'
                + '<div class="chart-bar-wrap">'
                + '<div class="chart-bar" style="height:' + height + '%"></div>'
                + '</div>'
                + '<span class="chart-label">' + esc(label) + '</span>'
                + '</div>';
        }).join('');
    }

    function renderLowStock(items) {
        if (!items.length) {
            dom.lowStockList.innerHTML = '<div class="empty-list">Все товары в достатке 👍</div>';
            return;
        }

        dom.lowStockList.innerHTML = items.map(function (item) {
            const badgeClass = item.qty <= 0 ? 'badge-out' : 'badge-low';
            return ''
                + '<button class="low-stock-item" data-supply-id="' + item.id + '" title="Оформить поставку">'
                + '<span>'
                + '<span class="low-stock-name">' + esc(item.name) + '</span><br>'
                + '<span class="low-stock-meta">Остаток: ' + item.qty + ' ' + esc(item.unit) + '</span>'
                + '</span>'
                + '<span class="badge ' + badgeClass + '">' + item.qty + '</span>'
                + '</button>';
        }).join('');
    }

    function renderRecentOrders(orders) {
        if (!orders.length) {
            dom.recentOrdersBody.innerHTML = '<tr><td colspan="6" class="empty-cell">Заказов пока нет</td></tr>';
            return;
        }

        dom.recentOrdersBody.innerHTML = orders.map(function (order) {
            return ''
                + '<tr>'
                + '<td><strong>№' + order.id + '</strong></td>'
                + '<td>' + (order.customer_name ? esc(order.customer_name) : '<span class="muted">Гость</span>') + '</td>'
                + '<td>' + window.fmt.money(order.total_amount) + '</td>'
                + '<td>' + window.fmt.money(order.profit) + '</td>'
                + '<td>' + statusBadge(order.status) + '</td>'
                + '<td class="muted">' + window.fmt.date(order.created_at, true) + '</td>'
                + '</tr>';
        }).join('');
    }

    function renderTopProducts(items) {
        if (!items.length) {
            dom.topProducts.innerHTML = '<div class="empty-list">Пока нет продаж</div>';
            return;
        }

        dom.topProducts.innerHTML = items.map(function (item, index) {
            return ''
                + '<div class="top-item">'
                + '<span class="rank">' + (index + 1) + '</span>'
                + '<span>'
                + '<span class="top-name">' + esc(item.product__name) + '</span><br>'
                + '<span class="top-meta">' + item.qty + ' ' + esc(item.product__unit) + '</span>'
                + '</span>'
                + '<span class="top-revenue">' + window.fmt.money(item.revenue) + '</span>'
                + '</div>';
        }).join('');
    }

    /* =========================
       CATEGORIES
    ========================= */

    async function loadCategories() {
        const categories = await API.get('/categories/');
        state.categories = Array.isArray(categories) ? categories : [];
        renderCategoryOptions();
    }

    function renderCategoryOptions() {
        const filter = dom.productCategoryFilter;
        const current = state.productFilters.category;

        filter.innerHTML = '<option value="all">Все категории</option>'
            + state.categories.map(function (category) {
                return '<option value="' + esc(category.slug) + '">'
                    + esc(category.name) + ' (' + category.products_count + ')</option>';
            }).join('');

        const hasCurrent = state.categories.some(function (category) {
            return category.slug === current;
        });
        filter.value = hasCurrent ? current : 'all';
        state.productFilters.category = filter.value;

        const select = dom.productCategory;
        const modalCurrent = select.value;
        select.innerHTML = state.categories.map(function (category) {
            return '<option value="' + category.id + '">' + esc(category.name) + '</option>';
        }).join('');

        const hasModalCurrent = state.categories.some(function (category) {
            return String(category.id) === String(modalCurrent);
        });
        if (hasModalCurrent) select.value = modalCurrent;
    }

    /* =========================
       PRODUCTS
    ========================= */

    async function loadProducts() {
        const params = new URLSearchParams();

        if (state.productFilters.search) params.set('search', state.productFilters.search);
        if (state.productFilters.category !== 'all') {
            params.set('category', state.productFilters.category);
        }
        if (state.productFilters.includeInactive) params.set('include_inactive', '1');

        try {
            const query = params.toString();
            const products = await API.get('/products/' + (query ? '?' + query : ''));
            state.products = Array.isArray(products) ? products : [];
            renderProductsTable();
        } catch (error) {
            handleError(error);
        }
    }

    function renderProductsTable() {
        if (!state.products.length) {
            dom.productsTableBody.innerHTML = '<tr><td colspan="6" class="empty-cell">Товары не найдены</td></tr>';
            return;
        }

        dom.productsTableBody.innerHTML = state.products.map(function (product) {
            const stock = Number(product.stock_quantity) || 0;
            const stockBadge = stock <= 0
                ? '<span class="badge badge-out">Нет</span>'
                : stock < 5
                    ? '<span class="badge badge-low">' + stock + '</span>'
                    : '<span class="badge badge-active">' + stock + '</span>';

            const thumb = product.image_src
                ? '<img src="' + esc(product.image_src) + '" alt="" loading="lazy" onerror="this.remove()">'
                : categoryIcon(product.category_slug);

            return ''
                + '<tr>'
                + '<td>'
                + '<div class="product-cell">'
                + '<div class="thumb">' + thumb + '</div>'
                + '<div>'
                + '<strong>' + esc(product.name) + '</strong>'
                + '<small>' + esc(product.unit) + ' · ID ' + product.id + '</small>'
                + '</div>'
                + '</div>'
                + '</td>'
                + '<td>' + esc(product.category_name) + '</td>'
                + '<td class="price-cell">'
                + '<strong>' + window.fmt.number(product.retail_price) + ' / '
                + window.fmt.number(product.wholesale_price) + '</strong>'
                + '<small>розн. / опт от ' + product.min_wholesale_qty + '</small>'
                + '</td>'
                + '<td>' + stockBadge + '</td>'
                + '<td>' + (product.is_active
                    ? '<span class="badge badge-active">В каталоге</span>'
                    : '<span class="badge badge-inactive">Скрыт</span>') + '</td>'
                + '<td class="right">'
                + '<div class="table-actions">'
                + '<button class="btn btn-ghost btn-sm" data-action="edit" data-id="' + product.id + '">Изменить</button>'
                + '<button class="btn btn-ghost btn-sm" data-action="toggle" data-id="' + product.id + '">'
                + (product.is_active ? 'Скрыть' : 'Показать') + '</button>'
                + '<button class="btn btn-danger btn-sm" data-action="delete" data-id="' + product.id
                + '" title="Удалить">✕</button>'
                + '</div>'
                + '</td>'
                + '</tr>';
        }).join('');
    }

    function openProductModal(product) {
        if (!product && !state.categories.length) {
            showToast('Сначала создайте категорию кнопкой «＋»', true);
            return;
        }

        dom.productForm.reset();
        dom.productId.value = product ? product.id : '';
        dom.productModalTitle.textContent = product ? 'Редактировать товар' : 'Новый товар';

        if (product) {
            dom.productName.value = product.name;
            dom.productCategory.value = product.category;
            dom.productUnit.value = product.unit || 'шт';
            dom.productRetail.value = product.retail_price;
            dom.productWholesale.value = product.wholesale_price;
            dom.productMinQty.value = product.min_wholesale_qty;
            dom.productCost.value = product.cost_price;
            dom.productStock.value = product.stock_quantity;
            dom.productImageUrl.value = product.image_url || '';
            dom.productActive.checked = !!product.is_active;
        } else {
            dom.productUnit.value = 'шт';
            dom.productMinQty.value = 10;
            dom.productStock.value = 0;
            dom.productActive.checked = true;
            if (state.categories.length) {
                dom.productCategory.value = state.categories[0].id;
            }
        }

        dom.productModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        dom.productName.focus();
    }

    function closeProductModal() {
        dom.productModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    function productPayload() {
        return {
            name: dom.productName.value.trim(),
            category: Number(dom.productCategory.value),
            unit: dom.productUnit.value.trim() || 'шт',
            retail_price: Number(dom.productRetail.value),
            wholesale_price: Number(dom.productWholesale.value),
            min_wholesale_qty: Number(dom.productMinQty.value) || 0,
            cost_price: Number(dom.productCost.value),
            stock_quantity: Number(dom.productStock.value) || 0,
            image_url: dom.productImageUrl.value.trim(),
            is_active: dom.productActive.checked,
        };
    }

    async function saveProduct(event) {
        event.preventDefault();

        const id = dom.productId.value;
        const payload = productPayload();
        const file = dom.productImageFile.files[0];

        if (!payload.name) return showToast('Укажите название товара', true);
        if (!payload.category) return showToast('Выберите категорию', true);

        let body;
        if (file) {
            body = new FormData();
            Object.keys(payload).forEach(function (key) {
                const value = payload[key];
                if (value === undefined || value === null) return;
                body.append(key, typeof value === 'boolean' ? String(value) : value);
            });
            body.append('image', file);
        } else {
            body = payload;
        }

        setButtonLoading(dom.saveProductBtn, true, 'Сохранение…');

        try {
            if (id) {
                await API.request('/products/' + id + '/', { method: 'PATCH', body: body });
                showToast('Товар обновлён');
            } else {
                await API.post('/products/', body);
                showToast('Товар добавлен');
            }

            closeProductModal();
            await loadCategories();
            await loadProducts();
        } catch (error) {
            handleError(error);
        } finally {
            setButtonLoading(dom.saveProductBtn, false);
        }
    }

    async function addCategory() {
        const name = window.prompt('Название новой категории');
        if (!name || !name.trim()) return;

        try {
            const category = await API.post('/categories/', { name: name.trim() });
            await loadCategories();
            if (category && category.id) dom.productCategory.value = category.id;
            showToast('Категория «' + category.name + '» добавлена');
        } catch (error) {
            handleError(error);
        }
    }

    /* =========================
       SUPPLY
    ========================= */

    async function loadSupplyData() {
        try {
            const results = await Promise.all([
                API.get('/products/?include_inactive=1'),
                loadOperations(true),
            ]);

            state.supplyProducts = Array.isArray(results[0]) ? results[0] : [];
            renderSupplyProducts();
        } catch (error) {
            handleError(error);
        }
    }

    function renderSupplyProducts() {
        const select = dom.supplyProduct;
        const current = select.value;

        select.innerHTML = '<option value="">— выберите товар —</option>'
            + state.supplyProducts.map(function (product) {
                return '<option value="' + product.id + '">'
                    + esc(product.name)
                    + (product.is_active ? '' : ' (скрыт)')
                    + ' — остаток ' + product.stock_quantity + ' ' + esc(product.unit)
                    + '</option>';
            }).join('');

        const exists = state.supplyProducts.some(function (product) {
            return String(product.id) === String(current);
        });
        if (exists) select.value = current;

        if (state.pendingSupplyId) {
            select.value = String(state.pendingSupplyId);
            state.pendingSupplyId = null;
            prefillSupplyCost();
            dom.supplyQuantity.focus();
        }
    }

    function prefillSupplyCost() {
        const product = state.supplyProducts.find(function (item) {
            return String(item.id) === String(dom.supplyProduct.value);
        });
        if (product) {
            dom.supplyCost.value = product.cost_price;
        }
    }

    async function loadOperations(silent) {
        const type = state.operationsType;
        let path = '/crm/operations/?limit=100';
        if (type !== 'all') path += '&type=' + encodeURIComponent(type);

        try {
            const operations = await API.get(path);
            renderOperations(Array.isArray(operations) ? operations : []);
        } catch (error) {
            if (!silent) handleError(error);
        }
    }

    function renderOperations(operations) {
        if (!operations.length) {
            dom.operationsTableBody.innerHTML = '<tr><td colspan="6" class="empty-cell">Операций пока нет</td></tr>';
            return;
        }

        dom.operationsTableBody.innerHTML = operations.map(function (operation) {
            const isIn = operation.operation_type === 'IN';
            return ''
                + '<tr>'
                + '<td><strong>' + esc(operation.product_name) + '</strong></td>'
                + '<td>' + (isIn
                    ? '<span class="badge badge-in">Приход</span>'
                    : '<span class="badge badge-out-operation">Расход</span>') + '</td>'
                + '<td>' + (isIn ? '+' : '−') + operation.quantity + '</td>'
                + '<td>' + window.fmt.money(operation.cost_price) + '</td>'
                + '<td class="muted">' + esc(operation.comment || '—') + '</td>'
                + '<td class="muted">' + window.fmt.date(operation.created_at, true) + '</td>'
                + '</tr>';
        }).join('');
    }

    async function submitSupply(event) {
        event.preventDefault();

        const productId = Number(dom.supplyProduct.value);
        const quantity = Number(dom.supplyQuantity.value);
        const costPrice = Number(dom.supplyCost.value);

        if (!productId) return showToast('Выберите товар', true);
        if (!quantity || quantity < 1) return showToast('Укажите количество', true);
        if (isNaN(costPrice) || costPrice < 0) return showToast('Укажите себестоимость', true);

        setButtonLoading(dom.supplySubmitBtn, true, 'Оформляем…');

        try {
            const result = await API.post('/crm/supply/', {
                product_id: productId,
                quantity: quantity,
                cost_price: costPrice,
                comment: dom.supplyComment.value.trim(),
            });

            showToast('Приход оформлен: ' + result.product_name + ', остаток ' + result.new_stock);

            dom.supplyForm.reset();
            dom.supplyProduct.value = '';
            await loadSupplyData();
        } catch (error) {
            handleError(error);
        } finally {
            setButtonLoading(dom.supplySubmitBtn, false);
        }
    }

    async function openSupplyFor(productId) {
        state.pendingSupplyId = productId;
        await switchView('supply');
    }

    /* =========================
       ORDERS
    ========================= */

    async function loadOrders() {
        const params = new URLSearchParams();
        if (state.ordersStatus !== 'all') params.set('status', state.ordersStatus);

        try {
            const query = params.toString();
            const orders = await API.get('/orders/' + (query ? '?' + query : ''));
            state.orders = Array.isArray(orders) ? orders : [];
            renderOrders();
        } catch (error) {
            handleError(error);
        }
    }

    function renderOrders() {
        dom.ordersCountLabel.textContent = state.orders.length + ' '
            + plural(state.orders.length, ['заказ', 'заказа', 'заказов']);

        if (!state.orders.length) {
            dom.ordersTableBody.innerHTML = '<tr><td colspan="7" class="empty-cell">Заказов нет</td></tr>';
            return;
        }

        const rows = [];

        state.orders.forEach(function (order) {
            const phone = String(order.customer_phone || '').replace(/[^\d+]/g, '');
            const customer = order.customer_name
                ? '<div class="customer-cell"><strong>' + esc(order.customer_name) + '</strong>'
                    + (phone ? '<a href="tel:' + esc(phone) + '">' + esc(order.customer_phone) + '</a>' : '')
                    + '</div>'
                : '<span class="muted">Гость</span>';

            const itemsLabel = order.items_count + ' '
                + plural(order.items_count, ['ед.', 'ед.', 'ед.']);

            rows.push(''
                + '<tr>'
                + '<td>'
                + '<button class="order-toggle" data-order="' + order.id + '">'
                + '№' + order.id + ' ▾'
                + '</button>'
                + '</td>'
                + '<td>' + customer + '</td>'
                + '<td>' + itemsLabel + '</td>'
                + '<td><strong>' + window.fmt.money(order.total_amount) + '</strong></td>'
                + '<td>' + window.fmt.money(order.profit) + '</td>'
                + '<td>'
                + '<select class="status-select" data-id="' + order.id + '">'
                + Object.keys(STATUS_LABELS).map(function (value) {
                    return '<option value="' + value + '"'
                        + (order.status === value ? ' selected' : '') + '>'
                        + STATUS_LABELS[value] + '</option>';
                }).join('')
                + '</select>'
                + '</td>'
                + '<td class="muted">' + window.fmt.date(order.created_at, true) + '</td>'
                + '</tr>');

            const details = (order.items || []).map(function (item) {
                return ''
                    + '<div class="order-details-line">'
                    + '<span>' + esc(item.product_name) + ' — ' + item.quantity + ' × '
                    + window.fmt.number(item.price_per_item) + ' сом</span>'
                    + '<strong>' + window.fmt.money(item.total) + '</strong>'
                    + '</div>';
            }).join('');

            rows.push(''
                + '<tr class="details-row" id="order-details-' + order.id + '" hidden>'
                + '<td colspan="7">'
                + '<div class="order-details">'
                + details
                + '<div class="order-details-line order-details-total">'
                + '<span>Итого</span>'
                + '<strong>' + window.fmt.money(order.total_amount) + '</strong>'
                + '</div>'
                + '</div>'
                + '</td>'
                + '</tr>');
        });

        dom.ordersTableBody.innerHTML = rows.join('');
    }

    async function changeOrderStatus(select) {
        const id = select.dataset.id;
        const order = state.orders.find(function (item) {
            return String(item.id) === String(id);
        });
        if (!order || select.value === order.status) return;

        if (select.value === 'cancelled' && !window.confirm(
            'Отменить заказ №' + id + '? Товары вернутся на склад.'
        )) {
            select.value = order.status;
            return;
        }

        select.disabled = true;

        try {
            const updated = await API.patch('/orders/' + id + '/', { status: select.value });
            showToast('Заказ №' + id + ': ' + (updated.status_display || select.value));
            await loadOrders();
        } catch (error) {
            select.value = order.status;
            handleError(error);
        } finally {
            select.disabled = false;
        }
    }

    /* =========================
       EVENTS
    ========================= */

    function bindEvents() {
        document.querySelectorAll('.nav-item').forEach(function (button) {
            button.addEventListener('click', function () {
                switchView(button.dataset.view);
            });
        });

        dom.refreshBtn.addEventListener('click', loadCurrentView);

        dom.statusChips.addEventListener('click', function (event) {
            const chip = event.target.closest('.chip');
            if (!chip) return;
            state.ordersStatus = chip.dataset.status;
            dom.ordersStatusFilter.value = chip.dataset.status;
            switchView('orders');
        });

        dom.lowStockList.addEventListener('click', function (event) {
            const item = event.target.closest('[data-supply-id]');
            if (!item) return;
            openSupplyFor(item.dataset.supplyId);
        });

        // Products
        dom.productSearch.addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function () {
                state.productFilters.search = dom.productSearch.value.trim();
                loadProducts();
            }, 300);
        });

        dom.productCategoryFilter.addEventListener('change', function () {
            state.productFilters.category = dom.productCategoryFilter.value;
            loadProducts();
        });

        dom.includeInactive.addEventListener('change', function () {
            state.productFilters.includeInactive = dom.includeInactive.checked;
            loadProducts();
        });

        dom.addProductBtn.addEventListener('click', function () {
            openProductModal(null);
        });

        dom.productsTableBody.addEventListener('click', async function (event) {
            const button = event.target.closest('[data-action]');
            if (!button) return;

            const id = button.dataset.id;
            const product = state.products.find(function (item) {
                return String(item.id) === String(id);
            });
            if (!product) return;

            if (button.dataset.action === 'edit') {
                openProductModal(product);
            }

            if (button.dataset.action === 'toggle') {
                try {
                    await API.patch('/products/' + id + '/', { is_active: !product.is_active });
                    showToast(product.is_active ? 'Товар скрыт из каталога' : 'Товар снова в каталоге');
                    await loadProducts();
                } catch (error) {
                    handleError(error);
                }
            }

            if (button.dataset.action === 'delete') {
                if (!window.confirm('Удалить товар «' + product.name + '»?')) return;
                try {
                    await API.delete('/products/' + id + '/');
                    showToast('Товар удалён');
                    await loadProducts();
                    await loadCategories();
                } catch (error) {
                    handleError(error);
                }
            }
        });

        // Product modal
        dom.closeProductModal.addEventListener('click', closeProductModal);
        dom.cancelProductModal.addEventListener('click', closeProductModal);
        dom.productModal.addEventListener('click', function (event) {
            if (event.target === dom.productModal) closeProductModal();
        });
        dom.addCategoryBtn.addEventListener('click', addCategory);
        dom.productForm.addEventListener('submit', saveProduct);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closeProductModal();
        });

        // Supply
        dom.supplyForm.addEventListener('submit', submitSupply);
        dom.supplyProduct.addEventListener('change', prefillSupplyCost);
        dom.operationsFilter.addEventListener('change', function () {
            state.operationsType = dom.operationsFilter.value;
            loadOperations();
        });

        // Orders
        dom.ordersStatusFilter.addEventListener('change', function () {
            state.ordersStatus = dom.ordersStatusFilter.value;
            loadOrders();
        });

        dom.ordersTableBody.addEventListener('click', function (event) {
            const button = event.target.closest('.order-toggle');
            if (!button) return;

            const id = button.dataset.order;
            const details = document.getElementById('order-details-' + id);
            if (!details) return;

            details.hidden = !details.hidden;
            button.textContent = '№' + id + (details.hidden ? ' ▾' : ' ▴');
        });

        dom.ordersTableBody.addEventListener('change', function (event) {
            const select = event.target.closest('.status-select');
            if (select) changeOrderStatus(select);
        });
    }

    /* =========================
       INIT
    ========================= */

    function cacheDom() {
        dom.pageTitle = document.getElementById('pageTitle');
        dom.pageSubtitle = document.getElementById('pageSubtitle');
        dom.refreshBtn = document.getElementById('refreshBtn');
        dom.statusChips = document.getElementById('statusChips');

        dom.statRevenue = document.getElementById('statRevenue');
        dom.statRevenueSub = document.getElementById('statRevenueSub');
        dom.statProfit = document.getElementById('statProfit');
        dom.statProfitSub = document.getElementById('statProfitSub');
        dom.statOrders = document.getElementById('statOrders');
        dom.statOrdersSub = document.getElementById('statOrdersSub');
        dom.statAvg = document.getElementById('statAvg');
        dom.statAvgSub = document.getElementById('statAvgSub');

        dom.salesChart = document.getElementById('salesChart');
        dom.lowStockList = document.getElementById('lowStockList');
        dom.recentOrdersBody = document.getElementById('recentOrdersBody');
        dom.topProducts = document.getElementById('topProducts');

        dom.productSearch = document.getElementById('productSearch');
        dom.productCategoryFilter = document.getElementById('productCategoryFilter');
        dom.includeInactive = document.getElementById('includeInactive');
        dom.addProductBtn = document.getElementById('addProductBtn');
        dom.productsTableBody = document.getElementById('productsTableBody');

        dom.productModal = document.getElementById('productModal');
        dom.productModalTitle = document.getElementById('productModalTitle');
        dom.productForm = document.getElementById('productForm');
        dom.productId = document.getElementById('productId');
        dom.productName = document.getElementById('productName');
        dom.productCategory = document.getElementById('productCategory');
        dom.productUnit = document.getElementById('productUnit');
        dom.productRetail = document.getElementById('productRetail');
        dom.productWholesale = document.getElementById('productWholesale');
        dom.productMinQty = document.getElementById('productMinQty');
        dom.productCost = document.getElementById('productCost');
        dom.productStock = document.getElementById('productStock');
        dom.productImageUrl = document.getElementById('productImageUrl');
        dom.productImageFile = document.getElementById('productImageFile');
        dom.productActive = document.getElementById('productActive');
        dom.addCategoryBtn = document.getElementById('addCategoryBtn');
        dom.closeProductModal = document.getElementById('closeProductModal');
        dom.cancelProductModal = document.getElementById('cancelProductModal');
        dom.saveProductBtn = document.getElementById('saveProductBtn');

        dom.supplyForm = document.getElementById('supplyForm');
        dom.supplyProduct = document.getElementById('supplyProduct');
        dom.supplyQuantity = document.getElementById('supplyQuantity');
        dom.supplyCost = document.getElementById('supplyCost');
        dom.supplyComment = document.getElementById('supplyComment');
        dom.supplySubmitBtn = document.getElementById('supplySubmitBtn');
        dom.operationsFilter = document.getElementById('operationsFilter');
        dom.operationsTableBody = document.getElementById('operationsTableBody');

        dom.ordersStatusFilter = document.getElementById('ordersStatusFilter');
        dom.ordersCountLabel = document.getElementById('ordersCountLabel');
        dom.ordersTableBody = document.getElementById('ordersTableBody');

        dom.toast = document.getElementById('toast');
    }

    async function init() {
        cacheDom();
        bindEvents();

        try {
            await loadCategories();
            await loadProducts();
        } catch (error) {
            handleError(error);
        }

        const hash = window.location.hash.replace('#', '');
        const initialView = VIEW_META[hash] ? hash : 'dashboard';
        await switchView(initialView);
    }

    init();
})();

export const DELIVERY_CATEGORIES = [
    '全部', '美食外卖', '奶茶饮品', '甜品蛋糕', '超市便利', '生鲜果蔬', '医药健康', '鲜花绿植',
] as const;

export type DeliveryCategory = Exclude<(typeof DELIVERY_CATEGORIES)[number], '全部'>;

export interface DeliveryCatalogProduct {
    id: string;
    name: string;
    description: string;
    price: number;
    imageKey: string;
    monthlySales: number;
}

export interface DeliveryCatalogStore {
    id: string;
    name: string;
    category: DeliveryCategory;
    subtitle: string;
    rating: number;
    distanceKm: number;
    etaMinutes: number;
    deliveryFee: number;
    minimumOrder: number;
    accent: string;
    products: DeliveryCatalogProduct[];
}

/**
 * 小体量、稳定的本地菜单。名称和商品像正常外卖店，但不冒充真实品牌，也不依赖远程接口。
 * imageKey 由 DeliveryProductArt 渲染为本地 SVG；离线或图片源失效时菜单仍可完整使用。
 */
export const DELIVERY_STORES: DeliveryCatalogStore[] = [
    {
        id: 'warm-kitchen', name: '暖禾小馆', category: '美食外卖', subtitle: '现炒家常菜 · 米饭套餐',
        rating: 4.8, distanceKm: 1.2, etaMinutes: 36, deliveryFee: 3, minimumOrder: 20, accent: '#f97316',
        products: [
            { id: 'tomato-beef-rice', name: '番茄肥牛饭', description: '酸甜番茄汤汁，配温泉蛋与时蔬', price: 28.8, imageKey: 'rice-tomato', monthlySales: 328 },
            { id: 'teriyaki-chicken', name: '照烧鸡腿饭', description: '去骨鸡腿、照烧汁与西兰花', price: 26.8, imageKey: 'rice-chicken', monthlySales: 265 },
            { id: 'pork-dumplings', name: '鲜肉锅贴', description: '底脆汁足，十只装', price: 18, imageKey: 'dumpling', monthlySales: 189 },
        ],
    },
    {
        id: 'tea-cloud', name: '云间茶事', category: '奶茶饮品', subtitle: '鲜奶茶 · 果茶 · 咖啡',
        rating: 4.9, distanceKm: 0.8, etaMinutes: 28, deliveryFee: 2, minimumOrder: 15, accent: '#0f766e',
        products: [
            { id: 'jasmine-milk-tea', name: '茉莉轻乳茶', description: '清雅茉莉，默认五分糖', price: 16, imageKey: 'tea-jasmine', monthlySales: 582 },
            { id: 'grape-ice', name: '多肉葡萄冰茶', description: '葡萄果肉与清爽茶底', price: 19, imageKey: 'tea-grape', monthlySales: 436 },
            { id: 'coconut-latte', name: '生椰拿铁', description: '椰香柔和，双份浓缩', price: 18, imageKey: 'coffee', monthlySales: 307 },
        ],
    },
    {
        id: 'sugar-room', name: '糖房烘焙', category: '甜品蛋糕', subtitle: '当天现做 · 低甜配方',
        rating: 4.7, distanceKm: 2.1, etaMinutes: 42, deliveryFee: 4, minimumOrder: 25, accent: '#db2777',
        products: [
            { id: 'strawberry-cake', name: '草莓奶油小蛋糕', description: '四寸动物奶油，适合一至两人', price: 58, imageKey: 'cake-strawberry', monthlySales: 156 },
            { id: 'tiramisu', name: '提拉米苏盒子', description: '马斯卡彭与咖啡酒香', price: 26, imageKey: 'tiramisu', monthlySales: 213 },
            { id: 'pudding', name: '焦糖布丁', description: '柔滑蛋奶布丁，两杯装', price: 19.8, imageKey: 'pudding', monthlySales: 178 },
        ],
    },
    {
        id: 'corner-mart', name: '转角便利', category: '超市便利', subtitle: '零食饮料 · 日用百货',
        rating: 4.8, distanceKm: 0.5, etaMinutes: 22, deliveryFee: 2, minimumOrder: 12, accent: '#2563eb',
        products: [
            { id: 'sparkling-water', name: '白桃气泡水', description: '330ml × 4 罐', price: 15.9, imageKey: 'soda', monthlySales: 421 },
            { id: 'sea-salt-chips', name: '海盐薯片', description: '轻盐薄脆，家庭分享装', price: 12.5, imageKey: 'chips', monthlySales: 347 },
            { id: 'tissue-pack', name: '原木抽纸', description: '三层柔韧，六包装', price: 18.9, imageKey: 'tissue', monthlySales: 298 },
        ],
    },
    {
        id: 'green-basket', name: '青篮鲜选', category: '生鲜果蔬', subtitle: '蔬果肉蛋 · 当日分拣',
        rating: 4.8, distanceKm: 2.6, etaMinutes: 46, deliveryFee: 5, minimumOrder: 30, accent: '#16a34a',
        products: [
            { id: 'fruit-box', name: '缤纷水果盒', description: '当季水果，约 800g', price: 32.8, imageKey: 'fruit', monthlySales: 247 },
            { id: 'vegetable-box', name: '一周蔬菜组合', description: '六种家常蔬菜，约 2kg', price: 29.9, imageKey: 'vegetable', monthlySales: 181 },
            { id: 'fresh-eggs', name: '谷物鲜鸡蛋', description: '可生食级，十枚装', price: 24.8, imageKey: 'egg', monthlySales: 225 },
        ],
    },
    {
        id: 'peace-pharmacy', name: '安心药房', category: '医药健康', subtitle: '家庭常备 · 健康护理',
        rating: 4.9, distanceKm: 1.7, etaMinutes: 30, deliveryFee: 3, minimumOrder: 0, accent: '#0891b2',
        products: [
            { id: 'bandages', name: '透气创可贴', description: '防水透气，二十片装', price: 12.8, imageKey: 'bandage', monthlySales: 398 },
            { id: 'thermometer', name: '电子体温计', description: '快速测温，蜂鸣提示', price: 29.9, imageKey: 'thermometer', monthlySales: 172 },
            { id: 'heat-patch', name: '暖贴', description: '持续发热，十片装', price: 16.9, imageKey: 'heat', monthlySales: 286 },
        ],
    },
    {
        id: 'daylight-flower', name: '日光花舍', category: '鲜花绿植', subtitle: '鲜花花束 · 桌面绿植',
        rating: 4.9, distanceKm: 3.3, etaMinutes: 52, deliveryFee: 6, minimumOrder: 39, accent: '#9333ea',
        products: [
            { id: 'sunflower-bouquet', name: '向日葵小花束', description: '向日葵与尤加利，简约包装', price: 68, imageKey: 'flower-sun', monthlySales: 139 },
            { id: 'rose-bouquet', name: '香槟玫瑰花束', description: '十一枝香槟玫瑰', price: 108, imageKey: 'flower-rose', monthlySales: 204 },
            { id: 'green-plant', name: '桌面绿植', description: '好养耐阴，陶瓷盆栽', price: 45, imageKey: 'plant', monthlySales: 116 },
        ],
    },
];

export const findDeliveryStore = (id: string): DeliveryCatalogStore | undefined =>
    DELIVERY_STORES.find(store => store.id === id);

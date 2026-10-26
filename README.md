# Hirbod Khodro

یک اپلیکیشن تحت وب حرفه‌ای و فارسی با نام «هم‌سود» برای مدیریت خریدوفروش خودرو، سرمایه‌گذاری و حسابداری شرکا بساز.

ویژگی‌های اصلی:

رابط کاربری کاملاً فارسی، راست‌چین (RTL)، مدرن و واکنش‌گرا برای موبایل و کامپیوتر.

داشبورد مدیریتی شامل مجموع سرمایه، ارزش معاملات، سود و زیان، موجودی نقدی و نمودارهای مالی.

ثبت خودرو با برند، مدل، سال ساخت، رنگ، شماره پلاک، قیمت خرید، هزینه‌های جانبی، قیمت فروش و وضعیت معامله.

ثبت چند شریک و میزان سرمایه هر شریک در هر معامله.

محاسبه خودکار سود یا زیان معامله و تقسیم سود متناسب با سهم سرمایه هر شریک در همان معامله.

ثبت دریافت‌ها، پرداخت‌ها، هزینه‌ها و تسویه‌حساب شرکا.

گزارش‌گیری بر اساس بازه زمانی، خودرو و شریک.

احراز هویت با ایمیل و رمز عبور.

دو سطح دسترسی: مدیر اصلی که به همه اطلاعات دسترسی دارد و شریک که فقط اطلاعات مالی شخصی خودش را می‌بیند.

از Supabase برای احراز هویت و پایگاه داده آنلاین استفاده کن تا اطلاعات بین دستگاه‌ها همگام‌سازی شوند.

امنیت اطلاعات را در سطح پایگاه داده با Row Level Security (RLS) پیاده‌سازی کن؛ محدودیت دسترسی نباید فقط در ظاهر سایت باشد.

اطلاعات مالی و سهم سرمایه هر شریک فقط برای همان شریک و مدیر اصلی قابل مشاهده باشد.

از داده‌های آزمایشی برای نمایش اولیه استفاده کن و آن‌ها را از اطلاعات واقعی جدا نگه دار.

قبل از انتشار نهایی، سیاست‌های امنیتی پایگاه داده و دسترسی نقش‌ها را بررسی کن.

ابتدا رابط کاربری و ساختار صفحات را ایجاد کن. سپس اتصال Supabase، جداول پایگاه داده، احراز هویت و سیاست‌های امنیتی را مرحله‌به‌مرحله پیاده‌سازی کن. تا زمانی که امنیت و دسترسی‌ها تأیید نشده‌اند، ادعا نکن که برنامه آماده استفاده واقعی است.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://hirbod-khodro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5e95af46-1023-4bba-8f8d-e0c48256077d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

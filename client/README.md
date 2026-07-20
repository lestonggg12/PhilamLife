# PHILAM Life - Client (Frontend)

Modern React-based frontend for the Homeowners Ledger & Payment System.

## 🎨 Features

- **Glassmorphism UI** - Modern, clean design with glass-effect cards
- **Responsive Layout** - Works on desktop, tablet, and mobile
- **Role-based Access** - Different views for Admin, Treasurer, Secretary
- **Real-time Dashboard** - Key metrics and recent activities
- **Component-based Architecture** - Modular and maintainable code

## 🚀 Quick Start

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production
```bash
npm run build
```

## 📁 Project Structure

```
client/
├── public/              # Static files
├── src/
│   ├── components/      # Reusable components (Sidebar, Navbar, Layout)
│   ├── pages/          # Page components (Dashboard, Properties, etc.)
│   ├── styles/         # Global CSS and theme
│   ├── services/       # API service calls
│   ├── assets/         # Images, icons
│   ├── App.jsx         # Main app component
│   └── main.jsx        # Entry point
└── package.json
```

## 🎨 Glassmorphism Theme

The design uses modern glass effect with:
- Semi-transparent backgrounds
- Backdrop blur effects
- Gradient text and buttons
- Soft shadows and animations
- Responsive grid layouts

## 🔌 API Integration

All API calls are centralized in `src/services/api.js` using Axios.

### Available Services:
- `authService` - Login/logout
- `propertiesService` - Property CRUD
- `ownersService` - Owner CRUD
- `paymentsService` - Payment handling
- `dashboardService` - Dashboard stats
- `reportsService` - Report generation

## 🛠️ Technologies

- **React 18** - UI framework
- **React Router v6** - Navigation
- **Vite** - Build tool
- **Axios** - HTTP client
- **CSS3** - Styling (no frameworks)

---

**Ready to connect with the backend!**




Admin Login:
Email: admin@philam.hoa (or ANY email)
Password: admin123 (or ANY password)
✅ Will login as Maria Garcia
Treasurer Login:
Email: treasurer@philam.hoa (or ANY email)
Password: treasurer123 (or ANY password)
✅ Will login as John Reyes
Secretary Login:
Email: secretary@philam.hoa (or ANY email)
Password: secretary123 (or ANY password)
✅ Will login as Angela Santos


# Stock Control System - Frontend

React + TypeScript + Vite frontend for the Stock Control System.

## Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **TailwindCSS** - Utility-first CSS framework
- **React Router DOM** - Client-side routing
- **React Query** (@tanstack/react-query) - Data fetching and caching
- **Axios** - HTTP client
- **zxing-js** - Barcode/QR code scanning
- **react-konva** - Canvas-based map editor

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm 10.x or later

### Installation

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The app will be available at http://localhost:5173

### Build

Build for production:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

### Linting

```bash
npm run lint
```

## Environment Variables

Create a `.env` file in the frontend directory (see `.env.example`):

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

## Project Structure

```
frontend/
├── src/
│   ├── components/        # Reusable components
│   │   ├── common/       # Common UI components
│   │   ├── auth/         # Authentication components
│   │   ├── items/        # Stock item components
│   │   ├── locations/    # Location components
│   │   ├── maps/         # Map editor components
│   │   ├── movements/    # Movement tracking components
│   │   └── notifications/ # Notification components
│   ├── pages/            # Page components
│   ├── hooks/            # Custom React hooks
│   ├── services/         # API services
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utility functions
│   ├── App.tsx           # Main app component
│   └── main.tsx          # App entry point
├── public/               # Static assets
└── package.json
```

## Features

- ✅ TypeScript for type safety
- ✅ TailwindCSS for styling
- ✅ React Query for data fetching
- ✅ Axios HTTP client with interceptors
- ✅ React Router for navigation
- ✅ ESLint + Prettier for code quality
- ✅ Environment-based configuration

## Next Steps

- Implement authentication flow
- Add item management UI
- Build location hierarchy interface
- Integrate barcode/QR scanning
- Create map editor with Konva


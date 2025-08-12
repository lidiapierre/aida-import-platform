# AIDA Ingest Console

A sleek, modern web application for uploading and processing CSV files with AI model recommendations. Built with Next.js, TypeScript, and Tailwind CSS.

## Features

- 🎯 **Drag & Drop Interface**: Intuitive file upload with visual feedback
- 📊 **CSV Processing**: Upload CSV files for AI model analysis
- 👤 **Gender Selection**: Choose from male, female, or other options
- 🎛️ **Model Board Input**: Specify model board parameters
- ✨ **Modern UI**: Clean, responsive design with smooth animations
- 🔄 **Real-time Feedback**: Live status updates and error handling
- 📱 **Mobile Responsive**: Works seamlessly on all devices

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Deployment**: Vercel

## API Integration

The application connects to the AIDA model recommendation service at:
`https://modelrecommendation-d8fdaa3e6179.herokuapp.com/ingest/process_csv`

### API Endpoint Details

- **Method**: POST
- **Content-Type**: multipart/form-data
- **Parameters**:
  - `file`: CSV file (binary)
  - `gender`: string (male/female/other)
  - `model_board`: string

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd aida_ingest_console
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
npm run build
npm start
```

## Deployment

This application is configured for easy deployment on Vercel:

1. Push your code to a Git repository
2. Connect your repository to Vercel
3. Deploy automatically with the included `vercel.json` configuration

## Usage

1. **Upload CSV File**: Drag and drop a CSV file or click to browse
2. **Select Gender**: Choose from the dropdown menu
3. **Enter Model Board**: Type your model board specification
4. **Process**: Click "Upload & Process" to send data to the API
5. **View Results**: See the processing results and any returned data

## File Structure

```
aida_ingest_console/
├── app/
│   ├── globals.css          # Global styles and Tailwind imports
│   ├── layout.tsx           # Root layout component
│   └── page.tsx             # Main application page
├── package.json             # Dependencies and scripts
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json           # TypeScript configuration
├── vercel.json             # Vercel deployment settings
└── README.md               # Project documentation
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License. 
import "./globals.css";

export const metadata = {
  title: "AI Landing Page Personalizer",
  description: "Personalize existing landing pages using ad-creative signal and CRO constraints."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";

export const metadata = {
  title: "Toolkit | Polaris",
  description: "A personal collection of tools.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import { Link } from "react-router-dom";

import Header from "../components/Header.jsx";
import Hero from "../components/Hero.jsx";
import Footer from "../components/Footer.jsx";
import { useMenu } from "../context/MenuContext.jsx";
import "../assets/css/Menu.css";

function Home() {
  const { products } = useMenu();
  const availableProducts = products.filter((product) => product.available);

  return (
    <>
      <Header />

      <main className="home-page">
        <Hero />
        <section className="home-menu-preview">
          <div className="home-menu-preview-inner">
            <span className="section-label">Fresh From Amaya</span>
            <h2>What is on the menu</h2>
            <div className="home-menu-preview-grid">
              {availableProducts.slice(0, 6).map((product) => (
                <article className="home-menu-preview-card" key={product.id}>
                  <img src={product.image} alt={product.name} />
                  <div><span>{product.category}</span><h3>{product.name}</h3><strong>{product.price}</strong></div>
                </article>
              ))}
            </div>
            <Link to="/menu" className="hero-primary-button">View full menu</Link>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

export default Home;
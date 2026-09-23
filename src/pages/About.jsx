
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Header from "../components/Header.jsx";
import { useBusiness } from "../context/BusinessContext.jsx";

import amayaLogo from "../assets/images/amayalogo.png";
import aboutBackground from "../assets/images/about/bg5.jpg";
import aboutSlide1 from "../assets/images/about/bg1.jpg";
import aboutSlide2 from "../assets/images/about/bg2.jpg";
import aboutSlide3 from "../assets/images/about/bg3.jpg";
import aboutSlide4 from "../assets/images/about/bg4.jpg";
import aboutSlide5 from "../assets/images/about/bg5.jpg";
import aboutSlide6 from "../assets/images/about/bg6.jpg";
import aboutSlide7 from "../assets/images/about/bg7.jpg";

import "../assets/css/About.css";

const aboutSlides = [
  {
    image: aboutSlide1,
    alt: "Amaya café atmosphere",
  },
  {
    image: aboutSlide2,
    alt: "Amaya food and dining experience",
  },
  {
    image: aboutSlide3,
    alt: "Amaya drinks and café experience",
  },
  {
    image: aboutSlide4,
    alt: "Amaya café interior and atmosphere",
  },
  {
    image: aboutSlide5,
    alt: "Amaya food and drinks",
  },
  {
    image: aboutSlide6,
    alt: "Customers enjoying the Amaya experience",
  },
  {
    image: aboutSlide7,
    alt: "Amaya café experience",
  },
];

const values = [
  "Quality",
  "Hospitality",
  "Consistency",
  "Care",
];

const experiences = [
  {
    number: "01",
    title: "Quality Food",
    description:
      "Carefully prepared food made to give you a satisfying and enjoyable experience.",
  },
  {
    number: "02",
    title: "Fresh Drinks",
    description:
      "Refreshing drinks made to complement your favorite meals and moments.",
  },
  {
    number: "03",
    title: "Warm Atmosphere",
    description:
      "A comfortable environment where customers can relax, eat, and enjoy their time.",
  },
  {
    number: "04",
    title: "Friendly Service",
    description:
      "We aim to make every customer feel welcomed and appreciated from the moment they arrive.",
  },
];

function About() {
  const { businessSettings } = useBusiness();
  const { businessName } = businessSettings;
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) {
      return undefined;
    }

    const interval = setInterval(() => {
      setActiveSlide((currentSlide) =>
        currentSlide === aboutSlides.length - 1
          ? 0
          : currentSlide + 1,
      );
    }, 3200);

    return () => clearInterval(interval);
  }, [isPaused]);

  const goToSlide = (index) => {
    setActiveSlide(index);
  };

  const goToNextSlide = () => {
    setActiveSlide((currentSlide) =>
      currentSlide === aboutSlides.length - 1
        ? 0
        : currentSlide + 1,
    );
  };

  return (
    <>
      <Header />

      <main className="about-page">
        <section
          className="about-hero"
          aria-label="About Amaya"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onFocus={() => setIsPaused(true)}
          onBlur={() => setIsPaused(false)}
        >
          <div
            className="about-hero-image-layer"
            aria-hidden="true"
          >
            {aboutSlides.map((slide, index) => (
              <img
                key={slide.image}
                className={`about-hero-slide ${
                  index === activeSlide ? "active" : ""
                }`}
                src={slide.image}
                alt=""
                loading={index === 0 ? "eager" : "lazy"}
              />
            ))}
          </div>

          <div
            className="about-hero-overlay"
            aria-hidden="true"
          ></div>

          <div className="about-hero-content">
            <span className="about-eyebrow">
              Our Story
            </span>

            <h1>
              More Than
              <br />
              Just a Café.
            </h1>

            <p>
              A place where good food, warm moments, and
              meaningful connections come together.
            </p>
          </div>

          <div
            className="about-hero-indicators"
            aria-label="About photo slideshow controls"
          >
            {aboutSlides.map((slide, index) => (
              <button
                key={slide.image}
                type="button"
                className={`about-hero-dot ${
                  index === activeSlide ? "active" : ""
                }`}
                aria-label={`Show photo ${index + 1}`}
                aria-current={
                  index === activeSlide ? "true" : undefined
                }
                onClick={() => goToSlide(index)}
              />
            ))}
          </div>
        </section>

        <section
          className="about-story"
          aria-labelledby="about-story-title"
        >
          <div className="about-container">
            <div className="about-story-image">
              <img
                src={aboutBackground}
                alt="Amaya café"
                loading="lazy"
              />
            </div>

            <div className="about-story-content">
              <span className="about-section-label">
                Who We Are
              </span>

              <h2 id="about-story-title">
                Welcome to
                <br />
                  {businessName}.
              </h2>

              <p>
                {businessName} is a café created with one simple idea:
                great food tastes even better when shared with
                good company.
              </p>

              <p>
                From freshly prepared meals and refreshing
                drinks to a comfortable atmosphere, we want
                every visit to feel welcoming and memorable.
              </p>

              <p>
                Whether you are catching up with friends,
                enjoying a quiet meal, or simply looking for
                something delicious, {businessName} is a place where
                you can feel right at home.
              </p>

              <Link
                to="/menu"
                className="about-story-button"
              >
                Explore Our Menu
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        <section
          className="about-purpose"
          aria-labelledby="about-purpose-title"
        >
          <div className="about-container">
            <div className="about-values-heading">
              <span className="about-section-label">
                What We Believe
              </span>

              <h2 id="about-purpose-title">
                Made With Purpose.
              </h2>

              <p>
                Everything we do at {businessName} is centered around
                creating a better experience for our customers.
              </p>
            </div>

            <div className="about-purpose-grid">
              <article className="about-purpose-item">
                <span>Our Purpose</span>

                <h3>Our Mission</h3>

                <p>
                  To serve delicious, quality food and drinks
                  while providing a warm and welcoming
                  experience for every customer.
                </p>
              </article>

              <div
                className="about-purpose-divider"
                aria-hidden="true"
              ></div>

              <article className="about-purpose-item">
                <span>Our Direction</span>

                <h3>Our Vision</h3>

                <p>
                  To become a trusted local café known for
                  great food, genuine hospitality, and
                  memorable moments.
                </p>
              </article>
            </div>

            <ul
              className="about-values-list"
              aria-label="Amaya core values"
            >
              {values.map((value) => (
                <li key={value}>
                  {value}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="about-special"
          aria-labelledby="about-special-title"
        >
          <div className="about-container">
            <div className="about-special-heading">
              <span className="about-section-label">
                The {businessName} Experience
              </span>

              <h2 id="about-special-title">
                Why Choose {businessName}?
              </h2>

              <p>
                We believe the little things can make every
                visit feel special.
              </p>
            </div>

            <div className="about-special-grid">
              {experiences.map((experience) => (
                <article
                  className="about-special-item"
                  key={experience.number}
                >
                  <span className="special-icon">
                    {experience.number}
                  </span>

                  <div>
                    <h3>{experience.title}</h3>

                    <p>
                      {experience.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="about-brand"
          aria-labelledby="about-brand-title"
        >
          <div className="about-brand-content">
            <div className="about-brand-logo">
              <img
                src={amayaLogo}
                alt="Amaya logo"
                loading="lazy"
              />
            </div>

            <span>
              Good Food. Great Moments.
            </span>

            <h2 id="about-brand-title">
              Every Moment
              <br />
              Starts Here.
            </h2>

            <p>
              Come visit {businessName} and make your next meal a
              moment worth remembering.
            </p>

            <Link
              to="/menu"
              className="about-brand-button"
            >
              Discover Our Menu
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </main>

    </>
  );
}

export default About;


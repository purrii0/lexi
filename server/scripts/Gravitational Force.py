from manim import *
from manim.animation.rate_functions import linear

class GravitationalForce(Scene):
    def construct(self):
        earth = Dot(point=ORIGIN, radius=0.5, color=BLUE)
        moon = Dot(point=[3, 0, 0], radius=0.2, color=GRAY)
        sun = Dot(point=[-10, 0, 0], radius=1.5, color=YELLOW)

        self.play(Create(earth), Create(moon), Create(sun))

        mass1 = Text("Mass1", font_size=24).next_to(earth, UP, buff=0.5)
        mass2 = Text("Mass2", font_size=24).next_to(moon, UP, buff=0.5)
        self.play(Create(mass1), Create(mass2))

        orbit_path = Circle(radius=3, color=WHITE, stroke_width=1).move_to(earth.get_center())
        self.play(Create(orbit_path))

        gravity_arrow = Arrow(start=earth.get_center(), end=moon.get_center(), buff=0, color=RED)
        self.play(Create(gravity_arrow))

        formula = Text("F = G * m1 * m2 / r^2", font_size=24).next_to(gravity_arrow, RIGHT, buff=0.5)
        self.play(Create(formula))

        scale_bar = Line(start=[-5, -4, 0], end=[-3, -4, 0], color=WHITE)
        scale_text = Text("1 AU", font_size=20).next_to(scale_bar, DOWN, buff=0.2)
        self.play(Create(scale_bar), Create(scale_text))

        self.play(MoveAlongPath(moon, orbit_path), run_time=5, rate_func=linear)

        self.play(
            FadeOut(earth),
            FadeOut(moon),
            FadeOut(sun),
            FadeOut(mass1),
            FadeOut(mass2),
            FadeOut(orbit_path),
            FadeOut(gravity_arrow),
            FadeOut(formula),
            FadeOut(scale_bar),
            FadeOut(scale_text)
        )
        self.wait(1)

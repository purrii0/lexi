from manim import *

class ForceVectorIllustration(Scene):
    def construct(self):
        # Ground line
        ground_line = Line(LEFT*3, RIGHT*3, color=WHITE).shift(DOWN)
        # Coordinate axes
        axes = Axes(
            x_range=[-4, 4, 1],
            y_range=[-1, 1, 1],
            x_length=8,
            y_length=2,
            axis_config={"color": BLUE}
        ).shift(DOWN)
        # Ball at rest on ground line
        ball = Dot(ground_line.get_start() + 0.5*UP, radius=0.2, color=RED)
        # Force arrow pointing right
        force_arrow = Arrow(
            start=ball.get_center(),
            end=ball.get_center() + 2*RIGHT,
            buff=0,
            color=YELLOW
        )
        force_label = MathTex(r"\vec{F}", color=YELLOW).next_to(force_arrow, UP, buff=0.1)
        # Acceleration arrow behind ball
        acc_arrow = Arrow(
            start=ball.get_center(),
            end=ball.get_center() - 1.5*RIGHT,
            buff=0,
            color=GREEN
        )
        acc_label = MathTex(r"\vec{a}", color=GREEN).next_to(acc_arrow, DOWN, buff=0.1)
        # Time label
        time_label = Tex(r"t=0", color=WHITE).next_to(axes, DOWN, buff=0.5)

        # Show ground line and axes
        self.play(Create(ground_line), Create(axes))
        self.wait(0.5)

        # Place ball
        self.play(Create(ball))
        self.wait(0.5)

        # Show force arrow and label
        self.play(Create(force_arrow), Write(force_label))
        self.wait(0.5)

        # Apply force: animate ball moving right
        self.play(ball.animate.shift(4*RIGHT), run_time=2)
        self.wait(0.5)

        # Show acceleration arrow and label
        self.play(Create(acc_arrow), Write(acc_label))
        self.wait(0.5)

        # Display time label
        self.play(Write(time_label))
        self.wait(1)

        # Fade out all arrows and labels
        self.play(
            FadeOut(force_arrow),
            FadeOut(force_label),
            FadeOut(acc_arrow),
            FadeOut(acc_label),
            FadeOut(time_label)
        )
        self.wait(0.5)

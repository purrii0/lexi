from manim import *

class PythagorasTheorem(Scene):
    def construct(self):
        # Create objects
        triangle = Triangle(fill_opacity=0.5, color=BLUE)
        hypotenuse = Line(triangle.points[0], triangle.points[2], color=YELLOW)
        base = Line(triangle.points[0], triangle.points[1], color=RED)
        height = Line(triangle.points[1], triangle.points[2], color=GREEN)
        
        # Draw right triangle
        self.play(Create(triangle))
        self.wait(2)
        
        # Label hypotenuse, base, height
        hypotenuse_label = MathTex('c').next_to(hypotenuse, UP)
        base_label = MathTex('a').next_to(base, DOWN)
        height_label = MathTex('b').next_to(height, LEFT)
        self.play(Write(hypotenuse_label), Write(base_label), Write(height_label))
        self.wait(1)
        
        # Animate Pythagoras formula
        formula = MathTex('a^2 + b^2 = c^2').to_edge(UP)
        self.play(Write(formula))
        self.wait(2)
        
        # Show captions
        caption1 = Text("\u0938\u092e\u0915\u094b\u0923 \u0924\u094d\u0930\u093f\u092d\u0941\u091c", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=2)
        self.wait(1)
        self.play(FadeOut(caption1))
        
        caption2 = Text("\u0915\u0930\u094d\u0923\u0915\u094b \u0926\u0948\u0930\u094d\u0917\u094d\u092f\u0915\u094b \u0935\u0930\u094d\u0917", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=3)
        self.wait(1)
        self.play(FadeOut(caption2))
        
        caption3 = Text("\u092a\u0948\u0925\u093e\u0917\u094b\u0930\u0938\u0915\u094b \u0938\u0942\u0924\u094d\u0930: a^2 + b^2 = c^2", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=4)
        self.wait(4)
        self.play(FadeOut(caption3))